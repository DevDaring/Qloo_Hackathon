"""Authentication, tenant checks, secret redaction and safe outbound fetches."""
from __future__ import annotations

import ipaddress
import logging
import re
import socket
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse

import bcrypt
import httpx
import jwt
from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .db import get_session
from .errors import AppError

COOKIE_NAME = "ll_session"
_JWT_ALG = "HS256"


# ---------------------------------------------------------------- passwords --
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


def issue_token(user_id: uuid.UUID, workspace_id: uuid.UUID) -> str:
    now = datetime.now(UTC)
    payload = {"sub": str(user_id), "ws": str(workspace_id), "iat": int(now.timestamp()),
               "exp": int((now + timedelta(hours=settings.SESSION_TTL_HOURS)).timestamp())}
    return jwt.encode(payload, settings.AUTH_SECRET, algorithm=_JWT_ALG)


@dataclass(frozen=True)
class Principal:
    user_id: uuid.UUID
    workspace_id: uuid.UUID
    role: str
    username: str
    is_demo: bool


async def current_principal(request: Request, session: AsyncSession = Depends(get_session)) -> Principal:
    from .models import Membership, User, Workspace

    token = request.cookies.get(COOKIE_NAME)
    auth = request.headers.get("authorization", "")
    if not token and auth.lower().startswith("bearer "):
        token = auth[7:].strip()
    if not token:
        raise AppError(401, "unauthenticated", "Sign in to continue.")
    try:
        data = jwt.decode(token, settings.AUTH_SECRET, algorithms=[_JWT_ALG])
        uid, wid = uuid.UUID(data["sub"]), uuid.UUID(data["ws"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise AppError(401, "invalid_session", "Your session has expired. Sign in again.") from None
    row = (await session.execute(
        select(User, Membership, Workspace)
        .join(Membership, Membership.user_id == User.id)
        .join(Workspace, Workspace.id == Membership.workspace_id)
        .where(User.id == uid, Membership.workspace_id == wid, User.is_active.is_(True))
    )).first()
    if not row:
        raise AppError(401, "invalid_session", "Your session is no longer valid.")
    user, membership, ws = row
    return Principal(user.id, ws.id, membership.role, user.username, ws.is_demo)


def require_editor(p: Principal = Depends(current_principal)) -> Principal:
    if p.role not in ("owner", "editor"):
        raise AppError(403, "forbidden", "Your role cannot change this workspace.")
    return p


# ---------------------------------------------------------------- redaction --
_KEYLIKE = re.compile(r"(?i)(sk-[A-Za-z0-9_\-]{16,}|xai-[A-Za-z0-9_\-]{16,}|Bearer\s+[A-Za-z0-9._\-]{16,}|"
                      r"(api[_-]?key|x-api-key|authorization|token|secret|password)(\"?\s*[:=]\s*\"?)[^\s\"',&]{6,})")


def redact(text: str) -> str:
    if not text:
        return text
    out = str(text)
    for secret in settings.secret_values():
        out = out.replace(secret, "[REDACTED]")
    return _KEYLIKE.sub(lambda m: (m.group(2) + m.group(3) + "[REDACTED]") if m.group(2) else "[REDACTED]", out)


def redact_obj(obj):
    if isinstance(obj, dict):
        return {k: ("[REDACTED]" if re.search(r"(?i)key|token|secret|password|authorization", str(k)) else redact_obj(v))
                for k, v in obj.items()}
    if isinstance(obj, list):
        return [redact_obj(v) for v in obj]
    if isinstance(obj, str):
        return redact(obj)
    return obj


class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
        except Exception:  # noqa: BLE001
            return True
        clean = redact(msg)
        if clean != msg:
            record.msg, record.args = clean, ()
        return True


def configure_logging() -> None:
    logging.basicConfig(level=settings.LOG_LEVEL, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    f = RedactingFilter()
    for h in logging.getLogger().handlers:
        h.addFilter(f)
    for noisy in ("httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


# ---------------------------------------------------------------- SSRF guard --
_ALLOWED_MEDIA = ("image/", "video/", "audio/")


def _is_public_host(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast
                or ip.is_reserved or ip.is_unspecified):
            return False
    return True


def validate_public_url(url: str) -> str:
    p = urlparse(url)
    if p.scheme != "https" or not p.hostname:
        raise AppError(400, "unsafe_url", "Only public https URLs can be fetched.")
    if not _is_public_host(p.hostname):
        raise AppError(400, "unsafe_url", "That address resolves to a private or internal network.")
    return url


async def fetch_media(url: str, max_bytes: int, expected: tuple[str, ...] = _ALLOWED_MEDIA) -> tuple[bytes, str]:
    """Download provider media from a public https URL: bounded redirects,
    bounded size, expected content types only. Never a general proxy."""
    current = validate_public_url(url)
    async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=15), follow_redirects=False) as client:
        for _ in range(4):
            async with client.stream("GET", current) as resp:
                if resp.status_code in (301, 302, 303, 307, 308):
                    current = validate_public_url(str(resp.headers.get("location", "")))
                    continue
                resp.raise_for_status()
                ctype = resp.headers.get("content-type", "").split(";")[0].strip().lower()
                if not ctype.startswith(expected) and ctype != "application/octet-stream":
                    raise AppError(502, "unexpected_media", f"Provider returned {ctype or 'unknown'} content.")
                buf = bytearray()
                async for chunk in resp.aiter_bytes():
                    buf.extend(chunk)
                    if len(buf) > max_bytes:
                        raise AppError(502, "media_too_large", "Provider media exceeded the size limit.")
                return bytes(buf), ctype
    raise AppError(502, "too_many_redirects", "Provider media redirected too many times.")
