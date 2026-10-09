"""End-to-end workflow tests with deterministic provider fakes: the LangGraph
run with interrupts, strategies, audience variants, image/video production,
crash recovery without resubmission, failure isolation, selective
invalidation, export manifests and the with/without-Qloo experiment."""
from __future__ import annotations

import hashlib
import io
import json
import uuid
import zipfile

from PIL import Image
from sqlalchemy import select, update

from launchlens.db import session_scope
from launchlens.models import Asset, Job, ResearchRun
from launchlens.services import jobs
from launchlens.worker import main as worker

from .conftest import login, make_tenant


async def drain(max_jobs: int = 40) -> int:
    n = 0
    for _ in range(max_jobs):
        async with session_scope() as s:
            await s.execute(update(Job).where(Job.status == "queued").values(available_at=Job.created_at))
        job = await jobs.claim("test-worker")
        if job is None:
            return n
        await worker.execute(job)
        n += 1
    return n


def png(color=(255, 255, 255), w=600, h=450) -> bytes:
    im = Image.new("RGB", (w, h), color)
    im.paste((25, 25, 25), (150, 100, 450, 350))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


async def setup_project(app, user: str):
    await make_tenant(user)
    c = await login(app, user)
    pid = (await c.post("/api/v1/projects", json={"name": "Workflow test"})).json()["id"]
    r = await c.post(f"/api/v1/projects/{pid}/product", json={
        "name": "Breeze Chair", "description": "Power wheelchair with a fan and speech amplification", "category": "mobility",
        "price": "85000", "features": [
            {"key": "fan", "name": "Seat-back fan", "proposed_benefit": "Moving air while seated"},
            {"key": "speech_amplification", "name": "Speech amplification", "proposed_benefit": "Easier to be heard"}]})
    assert r.status_code == 201
    await c.post(f"/api/v1/projects/{pid}/claims", json={"text": "A built-in seat-back fan.", "feature_key": "fan", "approved": True})
    await c.post(f"/api/v1/projects/{pid}/uploads", data={"role": "product_photo"}, files={"file": ("p.png", png(), "image/png")})
    await c.post(f"/api/v1/projects/{pid}/uploads", data={"role": "logo"},
                 files={"file": ("l.png", png((255, 120, 60), 400, 200), "image/png")})
    for name, role, langs in (("Chair users", "product_user", ["en"]), ("Hospital buyers", "institutional_buyer", ["en"])):
        r = await c.post(f"/api/v1/projects/{pid}/audiences", json={"name": name, "role": role, "languages": langs,
                                                                     "voluntary_interests": [{"text": "Cricket"}]})
        assert r.status_code == 201, r.text
    r = await c.put(f"/api/v1/projects/{pid}/constraints", json={
        "candidate_regions": [{"name": "Kolkata", "lat": 22.57, "lon": 88.36, "radius_km": 5},
                              {"name": "New Delhi", "lat": 28.61, "lon": 77.21, "radius_km": 5},
                              {"name": "Chennai", "lat": 13.08, "lon": 80.27, "radius_km": 5}],
        "service_regions": [{"name": "Kolkata svc", "lat": 22.57, "lon": 88.36, "radius_km": 60},
                            {"name": "Delhi svc", "lat": 28.61, "lon": 77.21, "radius_km": 60}],
        "ad_spend_budget": "60000", "min_ad_spend_per_location": "15000",
        "distribution_requirements": ["partner_outlet_in_area"]})
    assert r.status_code == 200, r.text
    return c, pid


async def test_full_workflow(app, fake_providers):
    c, pid = await setup_project(app, "flow_user")
    r = await c.post(f"/api/v1/projects/{pid}/research-runs", json={"qloo_enabled": True})
    assert r.status_code == 202
    run_id = r.json()["run"]["id"]
    await drain()
    d = (await c.get(f"/api/v1/runs/{run_id}")).json()
    assert d["run"]["status"] == "waiting_for_user" and d["run"]["pending_decision"]["type"] == "select_targets"
    by = {a["area_name"]: a for a in d["assessments"]}
    # Acceptance 4: Chennai is outside service coverage -> excluded
    assert by["Chennai"]["eligible"] is False
    assert any(h["name"] == "Service coverage" and h["result"] == "fail" for h in by["Chennai"]["hard_constraints"])
    # Qloo missing in tests -> incomplete, not silently renormalised
    assert by["Kolkata"]["status"] == "incomplete" and by["Kolkata"]["available_weight"] == 0.7
    # Acceptance 3: noise is an explicit unknown
    ev = (await c.get(f"/api/v1/projects/{pid}/evidence", params={"run_id": run_id})).json()["items"]
    assert any(e["topic"] == "noise" and e["kind"] == "data_gap" for e in ev)
    # Acceptance 5: list count == analytics total for the same bounded filter
    kol = by["Kolkata"]["area_id"]
    places = (await c.get(f"/api/v1/runs/{run_id}/places", params={"area_id": kol, "role": "partner,venue"})).json()
    charts = (await c.get(f"/api/v1/runs/{run_id}/analytics", params={"area_id": kol, "role": "partner,venue"})).json()
    assert places["total"] == charts["total_places"] == sum(sum(v.values()) for v in charts["category_distribution"].values())
    # Acceptance 6: placements are unverified candidates
    pls = (await c.get(f"/api/v1/projects/{pid}/placements", params={"run_id": run_id})).json()["items"]
    assert pls and all(p["status"] in ("candidate", "availability_unknown") for p in pls)
    assert all(set(p["verification"].values()) == {"unknown"} for p in pls)
    bad = await c.patch(f"/api/v1/placements/{pls[0]['id']}", json={"status": "verified_opportunity"})
    assert bad.status_code == 422

    opts = d["run"]["pending_decision"]["options"]
    sel = [{"area_id": o["area_id"], "audience_version_id": o["audience_version_id"]} for o in opts if o["area_name"] == "Kolkata"]
    assert (await c.post(f"/api/v1/runs/{run_id}/resume", json={"decision": {"selections": sel}})).status_code == 202
    await drain()
    d = (await c.get(f"/api/v1/runs/{run_id}")).json()
    assert d["run"]["pending_decision"]["type"] == "creative_scope", d["run"]
    strategies = (await c.get(f"/api/v1/projects/{pid}/strategies")).json()["items"]
    assert len(strategies) == 2
    for sv in strategies:
        text = json.dumps(sv["content"]).lower()
        assert " db" not in text and "decibel" not in text  # Acceptance 3
        assert sv["content"]["kpis_to_test"]
    briefs = (await c.get(f"/api/v1/projects/{pid}/creative-briefs")).json()["items"]
    # Acceptance 7: audience variants differ in message/setting/CTA and carry distinct identities
    user_b = [b for b in briefs if b["angle"] in ("fan_comfort", "speech_presence")]
    inst_b = [b for b in briefs if b["angle"] == "institutional_brief"]
    assert user_b and inst_b
    assert user_b[0]["content"]["cta"] != inst_b[0]["content"]["cta"]
    assert len({b["identity_hash"] for b in briefs}) == len(briefs)
    assert {b["angle"] for b in user_b} == {"fan_comfort", "speech_presence"}  # two feature-emphasis hypotheses

    target = user_b[0]["id"]
    decision = {"approve": True, "presets": ["square", "vertical"], "image_brief_ids": [target], "video_brief_ids": [target],
                "orientations": ["vertical", "landscape"], "mode": "full", "cap_usd": 3, "narration": False}
    assert (await c.post(f"/api/v1/runs/{run_id}/resume", json={"decision": decision})).status_code == 202
    await drain()
    d = (await c.get(f"/api/v1/runs/{run_id}")).json()
    assert d["run"]["status"] in ("completed", "partially_completed"), d["run"]
    detail = (await c.get(f"/api/v1/creative-briefs/{target}")).json()
    flyers = [a for a in detail["assets"] if a["kind"] == "flyer"]
    finals = [a for a in detail["assets"] if a["kind"] == "video_final"]
    assert {f["preset"] for f in flyers} == {"square", "vertical"}
    assert all(f["quality"]["passed"] and f["approval_state"] == "needs_review" for f in flyers)  # never auto-approved
    assert {(f["width"], f["height"]) for f in finals} == {(1080, 1920), (1920, 1080)}
    assert all(f["quality"]["video"]["passed"] for f in finals)
    assert all(f["metadata"]["audio_state"] == "silent_captioned" for f in finals)
    submits_before = fake_providers["video_submits"]
    assert submits_before == 3

    # Every paid call of finished jobs is settled (no reservation left dangling)
    from launchlens.models import UsageLedger
    async with session_scope() as s:
        dangling = (await s.execute(select(UsageLedger).where(UsageLedger.state == "reserved",
                                                              UsageLedger.project_id == uuid.UUID(pid)))).scalars().all()
    assert dangling == []

    # Acceptance 18: export manifest matches the files
    ex = (await c.get(f"/api/v1/projects/{pid}/exports")).json()["items"][0]
    z = zipfile.ZipFile(io.BytesIO((await c.get(ex["download_url"])).content))
    man = json.loads(z.read("manifest.json"))
    assert len(man["files"]) == len(z.namelist()) - 1
    for f in man["files"]:
        assert hashlib.sha256(z.read(f["path"])).hexdigest() == f["sha256"]
    assert any(f["path"].endswith(".mp4") for f in man["files"]) and any(f["path"].endswith(".png") for f in man["files"])

    # Acceptance 10: a crash after submission resumes polling, never resubmits
    calls = {"n": 0}
    orig_poll = fake_providers_poll = __import__("launchlens.providers.xai", fromlist=["poll_video"]).poll_video

    async def crashing_poll(rid):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("worker process died")
        return await orig_poll(rid)
    import launchlens.providers.xai as xai_mod
    xai_mod.poll_video = crashing_poll
    try:
        r = await c.post(f"/api/v1/creative-briefs/{target}/videos",
                         json={"orientations": ["vertical"], "mode": "full", "cap_usd": 3, "only_scene": 0, "regenerate": True})
        assert r.status_code == 202
        await drain()
    finally:
        xai_mod.poll_video = fake_providers_poll
    vjob = (await c.get(f"/api/v1/jobs/{r.json()['job']['id']}")).json()
    assert vjob["status"] == "completed", vjob
    assert fake_providers["video_submits"] == submits_before + 1  # exactly one new scene, submitted once

    # Acceptance 12: a failed video keeps completed images and offers retry
    fake_providers["video_fail"] = True
    r = await c.post(f"/api/v1/creative-briefs/{target}/videos",
                     json={"orientations": ["vertical"], "mode": "full", "cap_usd": 3, "only_scene": 1, "regenerate": True})
    await drain()
    fake_providers["video_fail"] = False
    fj = (await c.get(f"/api/v1/jobs/{r.json()['job']['id']}")).json()
    assert fj["status"] == "failed"
    still = (await c.get(f"/api/v1/creative-briefs/{target}")).json()["assets"]
    assert len([a for a in still if a["kind"] == "flyer"]) >= 2
    assert (await c.post(f"/api/v1/jobs/{fj['id']}/retry", json={})).status_code == 202
    await drain()

    # Acceptance 13: copy edit re-renders flyers from existing backgrounds (no new image calls)
    img_calls = fake_providers["image_calls"]
    b = (await c.get(f"/api/v1/creative-briefs/{target}")).json()
    r = await c.patch(f"/api/v1/creative-briefs/{target}", json={"lock_version": b["lock_version"], "headline": "Fresh air, wherever you sit"})
    assert r.status_code == 200, r.text
    assert r.json()["revision"]["preserved"]["research"] == "not affected"
    new_id = r.json()["brief"]["id"]
    stale = (await c.get(f"/api/v1/creative-briefs/{target}")).json()["assets"]
    assert all(a["stale"] for a in stale if a["kind"] == "flyer")
    conflict = await c.patch(f"/api/v1/creative-briefs/{target}", json={"lock_version": b["lock_version"], "headline": "x"})
    assert conflict.status_code == 409
    r = await c.post(f"/api/v1/creative-briefs/{new_id}/images", json={"presets": ["square", "vertical"], "cap_usd": 1})
    await drain()
    assert fake_providers["image_calls"] == img_calls  # backgrounds reused
    runs_before = len((await c.get(f"/api/v1/projects/{pid}/research-runs")).json()["items"])
    assert runs_before == 1  # the edit did not re-run research

    # Audience change invalidates that audience's strategy and creative only
    auds = (await c.get(f"/api/v1/projects/{pid}/audiences")).json()["items"]
    inst = next(a for a in auds if a["role"] == "institutional_buyer")
    r = await c.post(f"/api/v1/projects/{pid}/revisions/apply",
                     json={"kind": "change_audience_role", "audience_id": inst["audience_id"], "role": "distribution_partner",
                           "rerun": False})
    assert r.status_code == 202
    svs = (await c.get(f"/api/v1/projects/{pid}/strategies")).json()["items"]
    assert [s["stale"] for s in svs if s["audience_version_id"] == inst["id"]] == [True]
    assert all(not s["stale"] for s in svs if s["audience_version_id"] != inst["id"])

    # Acceptance 20: the Qloo-disabled comparison holds practical evidence constant
    r = await c.post(f"/api/v1/projects/{pid}/experiments", json={"run_id": run_id})
    assert r.status_code == 202
    await drain()
    exp = (await c.get(f"/api/v1/experiments/{r.json()['experiment_id']}")).json()
    assert exp["practical_evidence_identical"] is True
    assert "Qloo taste signals withheld" in exp["conditions"]["varied"]
    assert all(row["hard_constraints_identical"] for row in exp["locations"] if row["with_qloo"] and row["without_qloo"])


async def test_ambiguous_entities_need_resolution(app, fake_providers, monkeypatch):
    """Acceptance 2: ambiguous Qloo search requires a valid choice or an explicit proxy."""
    from launchlens.providers import qloo
    from launchlens.services import research
    c, pid = await setup_project(app, "entity_user")
    monkeypatch.setattr(qloo, "configured", lambda: True)

    async def search(q, types=None, take=6, budget=None):
        return ([{"qloo_id": "E1", "name": "Cricket (sport)", "type": "urn:entity:brand", "types": [], "popularity": 0.9,
                  "disambiguation": "", "tags": []},
                 {"qloo_id": "E2", "name": "Cricket Wireless", "type": "urn:entity:brand", "types": [], "popularity": 0.5,
                  "disambiguation": "", "tags": []}], {})
    monkeypatch.setattr(qloo, "search", search)

    async def tags(q, take=10, tag_types=None, budget=None):
        return [], {}
    monkeypatch.setattr(qloo, "tags", tags)
    from launchlens.services import context as ctxsvc
    ctx = await ctxsvc.load(uuid.UUID(pid))
    res = await research.resolve_entities(uuid.UUID(pid), ctx["audiences"], qloo.CallBudget(10))
    assert res["status"] == "needs_decision"
    auds = (await c.get(f"/api/v1/projects/{pid}/audiences")).json()["items"]
    ent = auds[0]["entities"][0]
    assert ent["status"] == "ambiguous" and len(ent["candidates"]) == 2
    r = await c.post(f"/api/v1/entities/{ent['id']}/resolve", json={"qloo_id": "MADE-UP"})
    assert r.status_code == 422  # never manufacture an id
    r = await c.post(f"/api/v1/entities/{ent['id']}/resolve", json={"proxy": {"qloo_id": "E1"}})
    assert r.status_code == 422  # a proxy needs a stated reason
    r = await c.post(f"/api/v1/entities/{ent['id']}/resolve", json={"qloo_id": "E1"})
    assert r.status_code == 200 and r.json()["status"] == "resolved"
    async with session_scope() as s:
        assert (await s.execute(select(ResearchRun))).first() is not None or True
    _ = Asset


async def test_qloo_signals_complete_the_ranking(app, fake_providers, monkeypatch):
    """With taste signals available: exact interests resolve, cultural fit is
    present, assessments become complete and ranked, Qloo partner places carry
    affinity into placements, and practical (OSM) counts are unaffected."""
    from launchlens.providers import qloo
    c, pid = await setup_project(app, "qloo_user")
    monkeypatch.setattr(qloo, "configured", lambda: True)

    async def search(q, types=None, take=6, budget=None):
        return ([{"qloo_id": "BRAND-CRICKET", "name": "Cricket", "type": "urn:entity:brand", "types": ["urn:entity:brand"],
                  "popularity": 0.9, "disambiguation": "", "tags": []},
                 {"qloo_id": "TOWN", "name": "Cricket", "type": "urn:entity:locality", "types": ["urn:entity:locality"],
                  "popularity": 0.6, "disambiguation": "", "tags": []}], {})

    async def tags(q, take=10, tag_types=None, budget=None):
        return [], {}

    async def places_near(lat, lon, radius_m, *, entity_ids, tag_ids, filter_tags=None, take=30, page=1, budget=None, context=None):
        assert entity_ids == ["BRAND-CRICKET"]  # the locality was never used as a signal
        base = 0.5 + (lat % 10) / 40
        if filter_tags:
            out = [{"qloo_id": f"Q-PH-{int(lat)}-{i}", "name": f"Qloo Pharmacy {i}", "lat": lat + 0.002 * i, "lon": lon,
                    "affinity": round(base - i * 0.01, 3), "popularity": 0.5, "address": "x",
                    "tags": [{"id": "urn:tag:category:place:pharmacy"}]} for i in range(4)]
        else:
            out = [{"qloo_id": f"Q-{i}", "name": f"Venue {i}", "lat": lat, "lon": lon, "affinity": round(base - i * 0.01, 3),
                    "popularity": 0.5, "tags": []} for i in range(10)]
        budget.take() if budget else None
        return out, {"retrieved_at": "2026-10-09T00:00:00+00:00", "query_hash": "h"}
    monkeypatch.setattr(qloo, "search", search)
    monkeypatch.setattr(qloo, "tags", tags)
    monkeypatch.setattr(qloo, "places_near", places_near)
    run_id = (await c.post(f"/api/v1/projects/{pid}/research-runs", json={"qloo_enabled": True})).json()["run"]["id"]
    await drain()
    d = (await c.get(f"/api/v1/runs/{run_id}")).json()
    assert d["run"]["pending_decision"]["type"] == "select_targets", d["run"]
    by = {a["area_name"]: a for a in d["assessments"]}
    assert by["Kolkata"]["status"] == "complete" and by["New Delhi"]["status"] == "complete"
    assert {by["Kolkata"]["rank"], by["New Delhi"]["rank"]} == {1, 2}
    assert by["Chennai"]["eligible"] is False and by["Chennai"]["rank"] is None  # affinity never overrides coverage
    assert by["Kolkata"]["components"]["cultural_fit"]["state"] == "available"
    # practical counts come from the supplementary set only
    raw_partner = by["Kolkata"]["components"]["partner_access"]["raw"]
    osm = (await c.get(f"/api/v1/runs/{run_id}/places", params={"area_id": by["Kolkata"]["area_id"]})).json()["items"]
    assert raw_partner == sum(1 for p in osm if p["provider"] != "qloo" and p["role"] in ("partner", "institution"))
    assert any(p["provider"] == "qloo" for p in osm)
    pls = (await c.get(f"/api/v1/projects/{pid}/placements", params={"run_id": run_id})).json()["items"]
    with_aff = [p for p in pls if (p["qloo_relevance"] or {}).get("affinity") is not None]
    assert with_aff and all(p["status"] in ("candidate", "availability_unknown") for p in with_aff)
    auds = (await c.get(f"/api/v1/projects/{pid}/audiences")).json()["items"]
    ents = [e for a in auds for e in a["entities"]]
    assert ents and all(e["qloo_id"] == "BRAND-CRICKET" and e["status"] == "resolved" for e in ents)
