"""Asset storage: local persistent volume in development, S3-compatible in
deployment. The database stores stable object keys, never expiring URLs."""
from __future__ import annotations

import asyncio
import hashlib
import mimetypes
import re
import uuid
from pathlib import Path

from .config import settings

_SAFE = re.compile(r"^[A-Za-z0-9/_\-.]+$")


def _check_key(key: str) -> str:
    if not _SAFE.match(key) or ".." in key or key.startswith("/"):
        raise ValueError("unsafe storage key")
    return key


def new_key(workspace_id: uuid.UUID, project_id: uuid.UUID | None, kind: str, ext: str) -> str:
    ext = re.sub(r"[^a-z0-9]", "", ext.lower().lstrip(".")) or "bin"
    proj = str(project_id) if project_id else "shared"
    return _check_key(f"ws/{workspace_id}/{proj}/{kind}/{uuid.uuid4().hex}.{ext}")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class LocalStorage:
    def __init__(self, root: str):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def path(self, key: str) -> Path:
        p = (self.root / _check_key(key)).resolve()
        if self.root not in p.parents:
            raise ValueError("path escapes storage root")
        return p

    async def put(self, key: str, data: bytes, content_type: str = "") -> None:
        p = self.path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(p.suffix + ".part")
        await asyncio.to_thread(tmp.write_bytes, data)
        await asyncio.to_thread(tmp.replace, p)

    async def put_file(self, key: str, src: Path, content_type: str = "") -> None:
        await self.put(key, await asyncio.to_thread(src.read_bytes), content_type)

    async def get(self, key: str) -> bytes:
        return await asyncio.to_thread(self.path(key).read_bytes)

    async def exists(self, key: str) -> bool:
        return self.path(key).exists()

    async def delete(self, key: str) -> None:
        p = self.path(key)
        if p.exists():
            await asyncio.to_thread(p.unlink)

    def local_path(self, key: str) -> Path | None:
        return self.path(key)


class S3Storage:
    def __init__(self):
        import boto3  # optional dependency, only needed when STORAGE_BACKEND=s3

        self.bucket = settings.S3_BUCKET
        self.client = boto3.client(
            "s3", endpoint_url=settings.S3_ENDPOINT_URL or None, region_name=settings.S3_REGION or None,
            aws_access_key_id=settings.S3_ACCESS_KEY_ID or None,
            aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY or None)

    async def put(self, key: str, data: bytes, content_type: str = "") -> None:
        ct = content_type or mimetypes.guess_type(key)[0] or "application/octet-stream"
        await asyncio.to_thread(self.client.put_object, Bucket=self.bucket, Key=_check_key(key), Body=data,
                                ContentType=ct)

    async def put_file(self, key: str, src: Path, content_type: str = "") -> None:
        await self.put(key, await asyncio.to_thread(src.read_bytes), content_type)

    async def get(self, key: str) -> bytes:
        obj = await asyncio.to_thread(self.client.get_object, Bucket=self.bucket, Key=_check_key(key))
        return await asyncio.to_thread(obj["Body"].read)

    async def exists(self, key: str) -> bool:
        try:
            await asyncio.to_thread(self.client.head_object, Bucket=self.bucket, Key=_check_key(key))
            return True
        except Exception:  # noqa: BLE001
            return False

    async def delete(self, key: str) -> None:
        await asyncio.to_thread(self.client.delete_object, Bucket=self.bucket, Key=_check_key(key))

    def local_path(self, key: str) -> Path | None:
        return None

    def presign(self, key: str, seconds: int = 600) -> str:
        return self.client.generate_presigned_url("get_object", Params={"Bucket": self.bucket, "Key": key},
                                                  ExpiresIn=seconds)


storage = S3Storage() if settings.STORAGE_BACKEND == "s3" else LocalStorage(settings.LOCAL_ASSET_DIR)
