"""Integration tests against PostgreSQL: API ownership, uploads, secrets,
durable jobs, leases, idempotency and cost caps."""
from __future__ import annotations

import asyncio
import io
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from PIL import Image
from sqlalchemy import select, update

from launchlens.config import settings
from launchlens.db import session_scope
from launchlens.errors import AppError
from launchlens.models import Job, ProviderAttempt, Workspace
from launchlens.services import costs, events, jobs

from .conftest import login, make_tenant


def png_bytes(w=400, h=300) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (200, 50, 50)).save(buf, "PNG")
    return buf.getvalue()


async def test_project_persists_and_resumes_after_restart(app):
    """Acceptance 1: create project + upload, then a fresh client (as after a
    browser refresh / server restart) sees the same state from PostgreSQL."""
    await make_tenant("alice")
    c = await login(app, "alice")
    r = await c.post("/api/v1/projects", json={"name": "Alpha"})
    pid = r.json()["id"]
    r = await c.post(f"/api/v1/projects/{pid}/product", json={
        "name": "Chair", "description": "A chair", "category": "mobility",
        "features": [{"key": "fan", "name": "Fan", "proposed_benefit": "air"}]})
    assert r.status_code == 201, r.text
    r = await c.post(f"/api/v1/projects/{pid}/uploads", data={"role": "product_photo"},
                     files={"file": ("p.png", png_bytes(), "image/png")})
    assert r.status_code == 201, r.text
    await c.aclose()
    c2 = await login(app, "alice")
    d = (await c2.get(f"/api/v1/projects/{pid}")).json()
    assert d["product"]["name"] == "Chair" and d["product_assets"][0]["role"] == "product_photo"
    asset_id = d["product_assets"][0]["asset_id"]
    r = await c2.get(f"/api/v1/assets/{asset_id}/download")
    assert r.status_code == 200 and r.content[:4] == b"\x89PNG"


async def test_upload_validation(app):
    await make_tenant("uploader")
    c = await login(app, "uploader")
    pid = (await c.post("/api/v1/projects", json={"name": "U"})).json()["id"]
    r = await c.post(f"/api/v1/projects/{pid}/uploads", data={"role": "product_photo"},
                     files={"file": ("x.png", b"MZ\x90\x00 not an image", "image/png")})
    assert r.status_code == 415
    r = await c.post(f"/api/v1/projects/{pid}/uploads", data={"role": "product_photo"},
                     files={"file": ("tiny.png", png_bytes(50, 50), "image/png")})
    assert r.status_code == 422


async def test_tenant_isolation(app):
    """Acceptance 15: tenant A cannot read tenant B's projects, assets, jobs,
    events or downloads."""
    await make_tenant("tenant_a")
    await make_tenant("tenant_b")
    a = await login(app, "tenant_a")
    b = await login(app, "tenant_b")
    pid = (await b.post("/api/v1/projects", json={"name": "B secret"})).json()["id"]
    up = await b.post(f"/api/v1/projects/{pid}/uploads", data={"role": "logo"}, files={"file": ("l.png", png_bytes(), "image/png")})
    aid = up.json()["asset"]["id"]
    ws_b = (await b.get("/api/v1/auth/me")).json()["workspace"]["id"]
    job, _ = await jobs.enqueue(workspace_id=uuid.UUID(ws_b), project_id=uuid.UUID(pid), kind="export", payload={},
                                idempotency_key="iso-test")
    await events.emit(uuid.UUID(ws_b), "test", "secret event", project_id=uuid.UUID(pid))
    for url in (f"/api/v1/projects/{pid}", f"/api/v1/assets/{aid}", f"/api/v1/assets/{aid}/download",
                f"/api/v1/jobs/{job.id}", f"/api/v1/projects/{pid}/events", f"/api/v1/projects/{pid}/evidence",
                f"/api/v1/projects/{pid}/assets"):
        r = await a.get(url)
        assert r.status_code == 404, (url, r.status_code)
    assert all(p["id"] != pid for p in (await a.get("/api/v1/projects")).json()["items"])
    r = await a.post(f"/api/v1/jobs/{job.id}/cancel")
    assert r.status_code == 404
    assert (await b.get(f"/api/v1/assets/{aid}/download")).status_code == 200


async def test_secrets_never_in_responses(app):
    """Acceptance 16 (API side): provider status and config expose no secret."""
    await make_tenant("secrets")
    c = await login(app, "secrets")
    bodies = [(await c.get("/api/v1/public-config")).text, (await c.get("/api/v1/openapi.json")).text]
    from launchlens.api import routes_creative
    routes_creative._status_cache.update(at=10**12, data={"note": "cached for test"})
    bodies.append((await c.get("/api/v1/providers/status")).text)
    for secret in settings.secret_values():
        for body in bodies:
            assert secret not in body


async def test_unauthenticated_and_error_shape(app):
    import httpx
    c = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
    r = await c.get("/api/v1/projects")
    assert r.status_code == 401
    err = r.json()["error"]
    assert set(err) >= {"request_id", "code", "message", "retryable", "fields"}
    r = await c.post("/api/v1/auth/login", json={"username": "nobody", "password": "x"})
    assert r.status_code == 401


# ---------------------------------------------------------------- jobs -------
async def _ws() -> uuid.UUID:
    _, ws = await make_tenant("jobs_owner")
    return ws.id


async def test_enqueue_is_idempotent():
    ws = await _ws()
    j1, c1 = await jobs.enqueue(workspace_id=ws, kind="export", payload={}, idempotency_key="same-key")
    j2, c2 = await jobs.enqueue(workspace_id=ws, kind="export", payload={"x": 1}, idempotency_key="same-key")
    assert c1 and not c2 and j1.id == j2.id


async def test_claims_are_atomic_under_concurrency():
    ws = await _ws()
    async with session_scope() as s:
        await s.execute(update(Job).where(Job.status == "queued").values(status="cancelled"))
    for i in range(6):
        await jobs.enqueue(workspace_id=ws, kind="export", payload={}, idempotency_key=f"claim-{i}")
    claimed = await asyncio.gather(*(jobs.claim(f"w{i}") for i in range(10)))
    ids = [j.id for j in claimed if j]
    assert len(ids) == 6 and len(set(ids)) == 6


async def test_expired_lease_is_recovered_and_unknown_submission_flagged():
    """Acceptance 10/11: a crashed worker's job is reclaimed; a paid attempt
    left 'prepared' without a remote id becomes submission_unknown (not retried)."""
    ws = await _ws()
    job, _ = await jobs.enqueue(workspace_id=ws, kind="images", payload={}, idempotency_key="lease-test")
    async with session_scope() as s:
        await s.execute(update(Job).where(Job.status == "queued", Job.id != job.id).values(status="cancelled"))
    j = await jobs.claim("crashed-worker")
    assert j.id == job.id
    att = await jobs.prepare_attempt(job=j, provider="xai", operation="image_generation", model="m", key="k-lease",
                                     request_summary={}, reserved=Decimal("0.02"))
    async with session_scope() as s:
        await s.execute(update(Job).where(Job.id == job.id).values(lease_expires_at=datetime.now(UTC) - timedelta(seconds=1)))
    j2 = await jobs.claim("new-worker")
    assert j2.id == job.id and j2.attempts == 2 and j2.lease_owner == "new-worker"
    n = await jobs.mark_interrupted_attempts_unknown(j2.id)
    assert n == 1
    async with session_scope() as s:
        a = await s.get(ProviderAttempt, att.id)
        assert a.status == "submission_unknown"
    # the old owner can no longer heartbeat the job
    assert await jobs.heartbeat(job.id, "crashed-worker") == "lost_lease"


async def test_cost_caps_hold_under_concurrent_reservations():
    """Acceptance 14: concurrent paid requests cannot overspend the daily cap."""
    _, ws = await make_tenant("capped", is_demo=True)
    async with session_scope() as s:
        w = await s.get(Workspace, ws.id)
        w.daily_cost_cap_usd = Decimal("0.10")

    async def one():
        try:
            await costs.reserve(workspace_id=ws.id, project_id=None, job_id=None, run_id=None, provider="xai",
                                model="grok-imagine-image", operation="image", category="image", quantity=1, unit="image")
            return True
        except AppError as e:
            assert e.code == "daily_cap_reached"
            return False
    results = await asyncio.gather(*(one() for _ in range(12)))
    assert sum(results) == 5  # 5 x $0.02 = $0.10
    summary = await costs.summary(ws.id)
    assert Decimal(summary["today_usd"]) <= Decimal("0.10")


async def test_job_cap_and_unknown_price():
    ws = await _ws()
    job, _ = await jobs.enqueue(workspace_id=ws, kind="video", payload={}, idempotency_key="cap-job",
                                cost_cap_usd=Decimal("0.30"))
    await costs.reserve(workspace_id=ws, project_id=None, job_id=job.id, run_id=None, provider="xai",
                        model="grok-imagine-video", operation="video", category="video", quantity=3, unit="second",
                        job_cap=Decimal("0.30"))  # 3 s * 0.05 * 1.5 headroom = 0.225
    with pytest.raises(AppError) as e:
        await costs.reserve(workspace_id=ws, project_id=None, job_id=job.id, run_id=None, provider="xai",
                            model="grok-imagine-video", operation="video", category="video", quantity=3, unit="second",
                            job_cap=Decimal("0.30"))
    assert e.value.code == "job_cap_reached"
    with pytest.raises(AppError) as e:
        await costs.reserve(workspace_id=ws, project_id=None, job_id=None, run_id=None, provider="qloo", model="insights",
                            operation="research", category="research", quantity=1, unit="request")
    assert e.value.code == "cost_unknown"
    await jobs.request_cancel(job.id)


async def test_retry_requires_reconciliation(app):
    """Acceptance 11 (API): an ambiguous paid submission blocks blind retry."""
    _, ws = await make_tenant("retrier")
    c = await login(app, "retrier")
    pid = (await c.post("/api/v1/projects", json={"name": "R"})).json()["id"]
    job, _ = await jobs.enqueue(workspace_id=ws.id, project_id=uuid.UUID(pid), kind="images",
                                payload={"brief_id": str(uuid.uuid4())}, idempotency_key="retry-me")
    att = await jobs.prepare_attempt(job=job, provider="xai", operation="image_generation", model="m", key="k-retry",
                                     request_summary={}, reserved=Decimal("0.02"))
    await jobs.update_attempt(att.id, status="submission_unknown")
    await jobs.finish(job.id, "failed", error={"kind": "submission_unknown"})
    r = await c.post(f"/api/v1/jobs/{job.id}/retry", json={})
    assert r.status_code == 409 and r.json()["error"]["code"] == "reconcile_first"
    r = await c.post(f"/api/v1/attempts/{att.id}/reconcile", json={"outcome": "not_charged"})
    assert r.status_code == 200
    r = await c.post(f"/api/v1/jobs/{job.id}/retry", json={})
    assert r.status_code == 202


async def test_unsupported_capability_is_reported_not_completed(monkeypatch):
    """Acceptance 19: an unsupported provider capability fails clearly."""
    from launchlens.providers import xai
    from launchlens.providers.base import ProviderError
    with pytest.raises(ProviderError) as e:
        xai.video_body("p", 5, "5:4", model="grok-imagine-video", image_ref=None)
    assert e.value.kind == "invalid_input"
    with pytest.raises(ProviderError) as e:
        await xai.generate_image("p", aspect_ratio="7:3")
    assert e.value.kind == "invalid_input"
    _ = select
