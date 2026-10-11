"""Test configuration.

Tests run against a separate PostgreSQL database (TEST_DATABASE_URL, default:
the .env DATABASE_URL with the database name `launchlens_test`). External
providers are replaced by deterministic fakes; these are automated-test mocks
only and never a silent live fallback. Live-provider checks live in
tests/live/ and are skipped unless LAUNCHLENS_LIVE=1.
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
CODES = BACKEND.parent


def _env_file_value(name: str) -> str:
    for line in (CODES / ".env").read_text().splitlines():
        if line.startswith(name + "="):
            return line.split("=", 1)[1].strip()
    return ""


TEST_DB = os.environ.get("TEST_DATABASE_URL") or _env_file_value("DATABASE_URL").rsplit("/", 1)[0] + "/launchlens_test"
os.environ["DATABASE_URL"] = TEST_DB
os.environ["LANGGRAPH_DATABASE_URL"] = ""
os.environ["LOCAL_ASSET_DIR"] = tempfile.mkdtemp(prefix="ll-test-assets-")
os.environ["APP_ENV"] = "test"
os.environ.setdefault("MAX_DAILY_COST_USD", "10")
os.environ["DEMO_DAILY_COST_USD"] = "5"
os.environ["JOB_LEASE_SECONDS"] = "30"
# Offline tests never call real providers: blank the keys that are not monkeypatched per test.
if os.environ.get("LAUNCHLENS_LIVE") != "1":
    for _k in ("QLOO_API_KEY", "SARVAM_API_KEY", "NANOGPT_API_KEY", "NANOGPT_FALLBACK_API_KEY"):
        os.environ[_k] = ""

import httpx  # noqa: E402
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from sqlalchemy import text  # noqa: E402


def pytest_sessionstart(session):
    env = dict(os.environ)
    r = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND, env=env,
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("alembic failed: " + r.stderr[-2000:])


@pytest_asyncio.fixture(scope="session", autouse=True)
async def _clean_db():
    from launchlens.db import engine
    async with engine.begin() as conn:
        rows = (await conn.execute(text(
            "select tablename from pg_tables where schemaname='public' and tablename not in ('spatial_ref_sys','alembic_version')"))).scalars().all()
        await conn.execute(text("TRUNCATE " + ", ".join(f'"{t}"' for t in rows) + " CASCADE"))
        await conn.execute(text("DROP SCHEMA IF EXISTS langgraph CASCADE"))
    yield
    from launchlens.graph import checkpoint
    await checkpoint.close()
    await engine.dispose()


@pytest_asyncio.fixture(scope="session")
async def app():
    from launchlens.main import app as _app
    return _app


async def make_tenant(username: str, password: str = "pw-12345678", *, is_demo: bool = False):
    from decimal import Decimal

    from launchlens.demo.seed import ensure_user
    return await ensure_user(username, password, f"{username} workspace", is_demo=is_demo, cap=Decimal("5"))


async def login(app, username: str, password: str = "pw-12345678") -> httpx.AsyncClient:
    c = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
    r = await c.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return c


@pytest.fixture
def fake_providers(monkeypatch):
    """Deterministic geo/climate/LLM/xAI fakes for workflow tests."""
    from launchlens.providers import geo, llm, xai
    from launchlens.providers.base import ProviderError

    async def osm_places(lat, lon, radius_m, profile=None):
        base = int(abs(lat * 10)) % 5
        items = []
        cats = [("pharmacy", "partner"), ("hospital", "institution"), ("community_centre", "venue"),
                ("shopping_mall", "venue"), ("medical_supply_store", "competitor"), ("clinic", "institution")]
        for i in range(12 + base * 3):
            cat, role = cats[i % len(cats)]
            items.append({"provider": "osm-overpass", "provider_id": f"node/{int(lat * 1000)}{i}", "name": f"{cat} {i}",
                          "category": cat, "role": role, "role_basis": "inferred_category", "lat": lat + i * 0.001,
                          "lon": lon + i * 0.001, "address": f"{i} Test Road", "provider_categories": [f"amenity={cat}"],
                          "accessibility": "unknown", "distance_m": 100.0 * i, "metadata": {}})
        return items, {"cached": False, "retrieved_at": "2026-10-08T00:00:00+00:00", "radius_m": radius_m, "query": "fake",
                       "source": "TEST FIXTURE (OSM-shaped)", "attribution": "test", "limit": 400}

    async def climate(lat, lon, years=(2023, 2025)):
        hot = round(30 + (lat % 10) * 5, 1)
        return ({"monthly_mean_daily_max_c": {m: 30.0 for m in range(1, 13)}, "hot_days_per_year_tmax_ge_35c": hot,
                 "days_per_year_apparent_ge_40c": 10.0, "hottest_month_mean_max_c": 38.0, "period": "2023..2025",
                 "units": "°C", "n_days": 1095},
                {"cached": False, "retrieved_at": "2026-10-08T00:00:00+00:00", "source": "TEST FIXTURE (Open-Meteo-shaped)",
                 "source_ref": "test", "kind": "historical_reanalysis", "attribution": "test"})

    async def geocode(q, cc="", limit=6):
        return [{"label": q, "lat": 22.5, "lon": 88.3, "type": "city", "category": "place", "importance": 0.9,
                 "osm_type": "relation", "osm_id": 1, "country_code": "IN", "state": "", "city": q, "bbox": None,
                 "source": "test", "attribution": "test"}], {"cached": False, "source": "test"}

    monkeypatch.setattr(geo, "osm_places", osm_places)
    monkeypatch.setattr(geo, "climate_summary", climate)
    monkeypatch.setattr(geo, "geocode", geocode)
    monkeypatch.setattr(llm, "_providers", lambda: [])  # templates; no network

    state = {"image_calls": 0, "video_submits": 0, "polls": 0, "video_fail": False, "submit_timeout": False}
    from PIL import Image
    import io

    async def gen_image(prompt, *, aspect_ratio="1:1", model=None, resolution="1k"):
        state["image_calls"] += 1
        w, h = {"1:1": (512, 512), "3:4": (480, 640), "9:16": (432, 768)}.get(aspect_ratio, (512, 512))
        buf = io.BytesIO()
        Image.new("RGB", (w, h), (90, 120, 160)).save(buf, "PNG")
        from decimal import Decimal
        return {"bytes": buf.getvalue(), "mime": "image/png", "cost_usd": Decimal("0.02"), "model": "fake-image"}

    async def start_video(body):
        if state["submit_timeout"]:
            raise ProviderError("xai", "submission_unknown", "simulated timeout after send")
        state["video_submits"] += 1
        return f"req-{state['video_submits']}"

    tmp = Path(tempfile.mkdtemp(prefix="ll-fakevid-"))
    clip = tmp / "clip.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=360x640:rate=24", "-t", "5", str(clip)],
                   check=True)

    async def poll_video(rid):
        state["polls"] += 1
        if state["video_fail"]:
            return {"state": "failed", "error": "simulated provider failure"}
        from decimal import Decimal
        return {"state": "done", "url": "https://example.test/clip.mp4", "duration": 5, "cost_usd": Decimal("0.25"),
                "model": "fake-video"}

    async def fetch_media(url, max_bytes, expected=()):
        return clip.read_bytes(), "video/mp4"

    monkeypatch.setattr(xai, "generate_image", gen_image)
    monkeypatch.setattr(xai, "start_video", start_video)
    monkeypatch.setattr(xai, "poll_video", poll_video)
    monkeypatch.setattr(xai, "configured", lambda: True)
    from launchlens.services import production
    monkeypatch.setattr(production, "fetch_media", fetch_media)

    async def no_review(asset):
        return {"model": None, "flags": [], "notes": "review skipped in tests", "passed": None}
    monkeypatch.setattr(production, "review_image", no_review)
    from launchlens.config import settings
    monkeypatch.setattr(settings, "XAI_POLL_INTERVAL_SECONDS", 0.01)
    return state


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    """Each test starts with fresh in-memory rate-limit windows (they are per process)."""
    from launchlens.api import deps
    for lim in (deps.login_limiter, deps.costly_limiter, deps.consult_limiter):
        lim.hits.clear()
    yield
