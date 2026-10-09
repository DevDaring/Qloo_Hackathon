"""Provider response cache in PostgreSQL.

The key is a hash of the provider, endpoint, sanitized parameters and any
audience/location context, plus the provider version, so a change in any of
them misses. Credentials are never part of the stored query.
"""
from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert

from ..db import session_scope
from ..models import ProviderCache


def stable_hash(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str, separators=(",", ":")).encode()).hexdigest()


def query_hash(provider: str, endpoint: str, params: dict, context: dict | None = None, version: str = "") -> str:
    return stable_hash({"p": provider, "e": endpoint, "q": params, "c": context or {}, "v": version})


async def get(provider: str, qhash: str) -> ProviderCache | None:
    async with session_scope() as s:
        row = (await s.execute(select(ProviderCache).where(
            ProviderCache.provider == provider, ProviderCache.query_hash == qhash,
            ProviderCache.expires_at > datetime.now(UTC)))).scalar_one_or_none()
        return row


async def put(provider: str, endpoint: str, qhash: str, params: dict, response: dict, ttl_s: int, *,
              version: str = "", redistributable: bool = False, status_code: int = 200) -> None:
    now = datetime.now(UTC)
    async with session_scope() as s:
        stmt = insert(ProviderCache).values(
            provider=provider, endpoint=endpoint, query_hash=qhash, query=params, provider_version=version,
            response=response, status_code=status_code, redistributable=redistributable,
            retrieved_at=now, expires_at=now + timedelta(seconds=ttl_s))
        await s.execute(stmt.on_conflict_do_update(
            index_elements=["provider", "query_hash"],
            set_={"response": response, "retrieved_at": now, "expires_at": now + timedelta(seconds=ttl_s),
                  "status_code": status_code}))


async def purge_expired() -> int:
    async with session_scope() as s:
        res = await s.execute(delete(ProviderCache).where(ProviderCache.expires_at < datetime.now(UTC)))
        return res.rowcount or 0
