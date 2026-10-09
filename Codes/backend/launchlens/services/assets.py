"""Asset creation and lookup. Bytes go to storage; the row keeps the key,
hash, type, dimensions and lineage. Originals are immutable: derivatives are
always new rows that point back via lineage."""
from __future__ import annotations

import io
import mimetypes
import uuid
from decimal import Decimal

from PIL import Image
from sqlalchemy import func, select

from ..db import session_scope
from ..models import Asset
from ..storage import new_key, sha256, storage

EXT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4", "audio/mpeg": "mp3",
       "audio/wav": "wav", "application/pdf": "pdf", "application/zip": "zip", "text/vtt": "vtt",
       "application/x-subrip": "srt", "application/json": "json", "text/plain": "txt", "text/markdown": "md"}


def image_dims(data: bytes) -> tuple[int | None, int | None]:
    try:
        with Image.open(io.BytesIO(data)) as im:
            return im.width, im.height
    except Exception:  # noqa: BLE001
        return None, None


async def save(*, workspace_id: uuid.UUID, project_id: uuid.UUID | None, kind: str, data: bytes, mime: str,
               source: str, label: str = "", is_original: bool = False, brief_id: uuid.UUID | None = None,
               identity_hash: str = "", preset: str = "", group_key: str = "", input_hash: str = "",
               lineage: dict | None = None, layout: dict | None = None, quality: dict | None = None,
               metadata: dict | None = None, provider_model: str = "", remote_request_id: str | None = None,
               approval_state: str = "draft", duration_s: float | None = None, original_filename: str = "",
               width: int | None = None, height: int | None = None) -> Asset:
    ext = EXT.get(mime) or (mimetypes.guess_extension(mime) or ".bin").lstrip(".")
    key = new_key(workspace_id, project_id, kind, ext)
    await storage.put(key, data, mime)
    if width is None and mime.startswith("image/"):
        width, height = image_dims(data)
    async with session_scope() as s:
        version = 1
        supersedes = None
        if group_key:
            prev = (await s.execute(select(Asset).where(Asset.workspace_id == workspace_id, Asset.group_key == group_key,
                                                        Asset.deleted_at.is_(None))
                                    .order_by(Asset.version.desc()).limit(1))).scalar_one_or_none()
            if prev:
                version, supersedes = prev.version + 1, prev.id
        a = Asset(id=uuid.uuid4(), workspace_id=workspace_id, project_id=project_id, kind=kind, storage_key=key,
                  sha256=sha256(data), mime_type=mime, bytes=len(data), width=width, height=height,
                  duration_s=Decimal(str(round(duration_s, 3))) if duration_s is not None else None,
                  original_filename=original_filename[:300], is_original=is_original, source=source, label=label,
                  provider_model=provider_model, remote_request_id=remote_request_id, brief_id=brief_id,
                  identity_hash=identity_hash, preset=preset, group_key=group_key, version=version,
                  supersedes_id=supersedes, input_hash=input_hash, lineage=lineage or {}, layout=layout or {},
                  quality=quality or {}, metadata_=metadata or {}, approval_state=approval_state)
        s.add(a)
    return a


async def load_bytes(asset: Asset) -> bytes:
    return await storage.get(asset.storage_key)


async def get(asset_id: uuid.UUID) -> Asset | None:
    async with session_scope() as s:
        return await s.get(Asset, asset_id)


async def latest_in_group(workspace_id: uuid.UUID, group_key: str) -> Asset | None:
    async with session_scope() as s:
        return (await s.execute(select(Asset).where(Asset.workspace_id == workspace_id, Asset.group_key == group_key,
                                                    Asset.deleted_at.is_(None))
                                .order_by(Asset.version.desc()).limit(1))).scalar_one_or_none()


async def find_by_input(workspace_id: uuid.UUID, kind: str, input_hash: str) -> Asset | None:
    """Reuse: an identical input already produced this asset (no new paid call)."""
    async with session_scope() as s:
        return (await s.execute(select(Asset).where(
            Asset.workspace_id == workspace_id, Asset.kind == kind, Asset.input_hash == input_hash,
            Asset.deleted_at.is_(None), Asset.stale.is_(False)).order_by(Asset.created_at.desc()).limit(1))).scalar_one_or_none()


async def count_for_project(project_id: uuid.UUID) -> dict:
    async with session_scope() as s:
        rows = (await s.execute(select(Asset.kind, func.count()).where(Asset.project_id == project_id,
                                                                        Asset.deleted_at.is_(None)).group_by(Asset.kind))).all()
    return {k: n for k, n in rows}
