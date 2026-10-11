"""Helpers for scripts/capture-guides.mjs (run manually, never part of the tests).

  guide_tools.py lock|unlock <project_id>   toggle projects.locked (reads DATABASE_URL from Codes/.env; never prints it)
  guide_tools.py webp <png_dir> <out_dir>    PNG crops -> 520 px wide WebP (quality ~82, kept under ~70 KB)

Run with the backend virtualenv (asyncpg and Pillow): backend/.venv/bin/python frontend/scripts/guide_tools.py …
"""
import asyncio
import os
import re
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # Codes/


def _db_url() -> str:
    env = {}
    for line in (ROOT / ".env").read_text().splitlines():
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", line):
            k, v = line.split("=", 1)
            env[k] = v.strip().strip('"').strip("'")
    url = os.environ.get("DATABASE_URL") or env.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL not found")
    return url.replace("postgresql+asyncpg", "postgresql")


async def _set_locked(pid: str, locked: bool) -> None:
    import asyncpg

    uuid.UUID(pid)  # validate before touching the database
    c = await asyncpg.connect(_db_url())
    try:
        n = await c.execute("UPDATE projects SET locked=$1 WHERE id=$2", locked, uuid.UUID(pid))
        print(f"{'locked' if locked else 'unlocked'} {pid} ({n})")
    finally:
        await c.close()


def _webp(src: Path, dst: Path) -> None:
    from PIL import Image

    dst.mkdir(parents=True, exist_ok=True)
    for png in sorted(src.rglob("*.png")):
        rel = png.relative_to(src).with_suffix(".webp")
        out = dst / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        im = Image.open(png).convert("RGB")
        w, h = im.size
        im = im.resize((520, round(h * 520 / w)), Image.LANCZOS)
        q = 82
        while True:
            im.save(out, "WEBP", quality=q, method=6)
            if out.stat().st_size <= 70_000 or q <= 50:
                break
            q -= 6
        print(f"{rel}  {out.stat().st_size // 1024} KB  q{q}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd in ("lock", "unlock"):
        asyncio.run(_set_locked(sys.argv[2], cmd == "lock"))
    elif cmd == "webp":
        _webp(Path(sys.argv[2]), Path(sys.argv[3]))
    else:
        sys.exit(__doc__)
