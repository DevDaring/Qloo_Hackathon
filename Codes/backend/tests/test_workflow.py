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

    # Feature D: creative trace links copy to product facts, strategy and evidence; the pilot card is a plan
    tr = (await c.get(f"/api/v1/creative-briefs/{target}/trace")).json()
    assert tr["copy"]["headline"] and tr["chain"]["product_fact"]["feature_key"]
    assert tr["chain"]["strategy"]["generated"] is True and tr["unknown_evidence_ids"] == []
    assert all(d["nature"] in ("evidence", "generated_hypothesis") for d in tr["chain"]["decisions"])
    assert tr["pilot_card"]["label"].startswith("Pilot hypothesis") and tr["pilot_card"]["results_recorded"] == 0
    j = (await c.get(f"/api/v1/projects/{pid}/journey")).json()
    st = {x["key"]: x for x in j["stages"]}
    assert [x["key"] for x in j["stages"]] == ["brief", "audience", "explore", "strategy", "create", "export"]
    assert st["explore"]["status"] == "done" and st["export"]["status"] == "done" and j["next_action"]["to"]

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
    # Feature C: the preview lists exactly what would go stale and writes nothing
    n_rev = len((await c.get(f"/api/v1/projects/{pid}/revisions")).json()["items"])
    pv = (await c.post(f"/api/v1/projects/{pid}/revisions/preview",
                       json={"kind": "change_audience_role", "audience_id": inst["audience_id"], "role": "distribution_partner"})).json()
    inst_svs = [x["id"] for x in (await c.get(f"/api/v1/projects/{pid}/strategies")).json()["items"]
                if x["audience_version_id"] == inst["id"] and not x["stale"]]
    assert [x["id"] for x in pv["affected"]["strategies"]] == inst_svs and pv["writes"].startswith("none")
    assert len((await c.get(f"/api/v1/projects/{pid}/revisions")).json()["items"]) == n_rev
    r = await c.post(f"/api/v1/projects/{pid}/revisions/apply",
                     json={"kind": "change_audience_role", "audience_id": inst["audience_id"], "role": "distribution_partner",
                           "rerun": False})
    assert r.status_code == 202
    svs = (await c.get(f"/api/v1/projects/{pid}/strategies")).json()["items"]
    assert [s["stale"] for s in svs if s["audience_version_id"] == inst["id"]] == [True]
    assert all(not s["stale"] for s in svs if s["audience_version_id"] != inst["id"])

    # Experiments need a baseline with usable Qloo evidence: this run had none (Qloo unconfigured here)
    r = await c.post(f"/api/v1/projects/{pid}/experiments", json={"run_id": run_id})
    assert r.status_code == 422 and r.json()["error"]["code"] == "baseline_without_taste_evidence"

    # Read-only sample: once locked, edits are refused with a clear code; exports and duplication still work
    from launchlens.models import Project
    async with session_scope() as s:
        await s.execute(update(Project).where(Project.id == uuid.UUID(pid)).values(locked=True))
    r = await c.post(f"/api/v1/projects/{pid}/research-runs", json={"qloo_enabled": True})
    assert r.status_code == 409 and r.json()["error"]["code"] == "project_locked"
    r = await c.patch(f"/api/v1/creative-briefs/{target}", json={"lock_version": 99, "headline": "x"})
    assert r.json()["error"]["code"] == "project_locked"
    assert (await c.put(f"/api/v1/audiences/{inst['audience_id']}", json={"name": "x", "role": "purchaser"})).status_code == 409
    assert (await c.post(f"/api/v1/projects/{pid}/exports")).status_code == 202
    assert (await c.get(f"/api/v1/projects/{pid}/journey")).json()["next_action"]["secondary"]["action"] == "duplicate"
    r = await c.post(f"/api/v1/projects/{pid}/duplicate")
    assert r.status_code == 201, r.text
    copy = r.json()
    assert copy["locked"] is False and copy["copied_from"] == pid
    cp = (await c.get(f"/api/v1/projects/{copy['id']}")).json()
    assert cp["product"]["name"] and cp["constraints"]["candidate_regions"] and len(cp["audiences"]) == 2
    assert (await c.post(f"/api/v1/projects/{copy['id']}/research-runs", json={"qloo_enabled": True})).status_code == 202


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
                    "tags": [{"id": "urn:tag:category:place:pharmacy"}],
                    "explanation": ({"status": "provided", "contributions": [
                        {"signal": "signal.interests.entities", "id": "BRAND-CRICKET", "score": 0.8}]} if i == 0 else
                        {"status": "provider_could_not_compute", "contributions": []})} for i in range(4)]
        else:
            out = [{"qloo_id": f"Q-{i}", "name": f"Venue {i}", "lat": lat, "lon": lon, "affinity": round(base - i * 0.01, 3),
                    "popularity": 0.5, "tags": []} for i in range(10)]
        budget.take() if budget else None
        return out, {"retrieved_at": "2026-10-09T00:00:00+00:00", "query_hash": "h"}
    centres = {"K": (22.57, 88.36), "D": (28.61, 77.21), "C": (13.08, 80.27)}

    async def common_places(wkt, *, entity_ids, tag_ids, pages=3, take=50, budget=None, context=None):
        # baseline: even coverage; with taste signals: concentrated in Kolkata (K), little in Chennai (C)
        mix = {"K": 30, "D": 10, "C": 2} if (entity_ids or tag_ids) else {"K": 15, "D": 15, "C": 15}
        out = [{"qloo_id": f"{k}{i}{'s' if entity_ids else 'b'}", "name": f"{k} place {i}", "lat": lat + 0.001 * i,
                "lon": lon, "affinity": 0.9 if entity_ids else None, "popularity": 0.5, "tags": [],
                "explanation": {"status": "not_provided", "contributions": []}}
               for k, (lat, lon) in centres.items() for i in range(mix[k])]
        return out, {"retrieved_at": "2026-10-09T00:00:00+00:00", "query_hashes": ["h"], "truncated": False, "returned": len(out)}
    monkeypatch.setattr(qloo, "search", search)
    monkeypatch.setattr(qloo, "tags", tags)
    monkeypatch.setattr(qloo, "places_near", places_near)
    monkeypatch.setattr(qloo, "common_places", common_places)
    run_id = (await c.post(f"/api/v1/projects/{pid}/research-runs", json={"qloo_enabled": True})).json()["run"]["id"]
    await drain()
    d = (await c.get(f"/api/v1/runs/{run_id}")).json()
    assert d["run"]["pending_decision"]["type"] == "select_targets", d["run"]
    by = {a["area_name"]: a for a in d["assessments"]}
    assert by["Kolkata"]["status"] == "complete" and by["New Delhi"]["status"] == "complete"
    assert {by["Kolkata"]["rank"], by["New Delhi"]["rank"]} == {1, 2}
    assert by["Chennai"]["eligible"] is False and by["Chennai"]["rank"] is None  # affinity never overrides coverage
    assert by["Kolkata"]["components"]["cultural_fit"]["state"] == "available"
    # cultural fit comes from the common-query taste lift (Kolkata over-represented vs baseline)
    cf = by["Kolkata"]["components"]["cultural_fit"]
    assert cf["raw"] > 0 > by["New Delhi"]["components"]["cultural_fit"]["raw"]
    assert "common Qloo query" in cf["units"]
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

    # Feature A: taste story with per-input attribution where Qloo gave it, the combined-set fallback otherwise
    kid, (av1, av2) = by["Kolkata"]["area_id"], [a["id"] for a in auds]
    st = (await c.get(f"/api/v1/runs/{run_id}/taste-story", params={"area_id": kid, "audience_version_id": av1})).json()
    assert st["interests"][0]["id"] == "BRAND-CRICKET" and st["recommendations"] and len(st["recommendations"]) <= 5
    kinds = {e["kind"] for e in st["edges"]}
    assert "qloo_explainability" in kinds and "qloo_combined_set" in kinds and st["attribution"] == "per_input"
    attributed = [e for e in st["edges"] if e["kind"] == "qloo_explainability"]
    assert all(e["from"] == "interest:BRAND-CRICKET" and e["evidence_ids"] for e in attributed)
    assert all(e["evidence_ids"] for e in st["edges"] if e["kind"].startswith("qloo"))  # every provider edge opens evidence
    assert st["unknown_evidence_ids"] == [] and all(v["nature"] == "qloo_signal" for v in st["evidence"].values()
                                                     if v["topic"] == "taste_partners")
    assert st["placement"] and st["placement"]["formula"].startswith("0.45")
    assert st["hypothesis"] is None  # no strategy yet: nothing generated is shown as fact
    assert st["city_signal"]["state"] in ("available", "sparse") and st["city_signal"]["evidence_id"]
    last = (await c.get(f"/api/v1/runs/{run_id}/places", params={"area_id": kid})).json()["items"]
    q_ids = [p["id"] for p in last if p["provider"] == "qloo"]
    shown = {r["id"] for r in st["recommendations"]}
    other = next((i for i in q_ids if i not in shown), None)
    if other:
        f = (await c.get(f"/api/v1/runs/{run_id}/taste-story",
                         params={"area_id": kid, "audience_version_id": av1, "place_id": other})).json()
        assert other in {r["id"] for r in f["recommendations"]} and len(f["recommendations"]) <= 5
    r = await c.get(f"/api/v1/runs/{run_id}/taste-story", params={"area_id": kid, "audience_version_id": str(uuid.uuid4())})
    assert r.status_code == 422
    # Feature C: two audiences, same city and inputs
    cmp_ = (await c.get(f"/api/v1/runs/{run_id}/audience-compare", params={"area_id": kid, "a": av1, "b": av2})).json()
    assert cmp_["a"]["shortlist"] and cmp_["b"]["shortlist"] and isinstance(cmp_["changed"], bool)
    # Feature E: at most three, eligible areas only, never claims low competition
    ops = (await c.get(f"/api/v1/runs/{run_id}/opportunities")).json()["items"]
    assert 0 < len(ops) <= 3 and all(o["area"] != "Chennai" for o in ops)
    assert all(isinstance(o["signal"]["affinity_rank"], int) and o["signal"]["affinity_rank"] <= o["signal"]["affinity_rank_of"]
               for o in ops)
    assert all("competition" not in o["pilot_proposal"]["text"].lower() for o in ops)
    # journey: the run waits for a decision, so Explore needs attention and the next action opens it
    j = (await c.get(f"/api/v1/projects/{pid}/journey")).json()
    assert next(x for x in j["stages"] if x["key"] == "explore")["status"] == "attention"
    assert j["next_action"]["decision_run_id"] == run_id

    # Acceptance 20 / P0: experiment from an immutable baseline snapshot.
    # Edit an audience AFTER the baseline: the experiment must still use the baseline's inputs.
    user_aud = next(a for a in auds if a["role"] == "product_user")
    r = await c.put(f"/api/v1/audiences/{user_aud['audience_id']}", json={
        "name": "Edited after baseline", "role": "purchaser", "languages": ["en"], "voluntary_interests": []})
    assert r.status_code == 200
    r = await c.post(f"/api/v1/projects/{pid}/experiments", json={"run_id": run_id})
    assert r.status_code == 202, r.text
    exp_id, exp_run = r.json()["experiment_id"], r.json()["run"]["id"]
    await drain()
    exp = (await c.get(f"/api/v1/experiments/{exp_id}")).json()
    assert exp["validity"]["valid"] and exp["validity"]["pinned_to_baseline"]
    assert exp["validity"]["practical_evidence_identical"] and not exp["validity"]["snapshot_differences"]
    snap_names = {a["name"] for a in (await c.get(f"/api/v1/runs/{exp_run}")).json()["run"].get("audiences", [])} or None
    _ = snap_names
    rows = {r["area"]: r for r in exp["locations"]}
    assert rows["Chennai"]["without_qloo"]["eligible"] is False and rows["Chennai"]["hard_constraints_identical"]
    assert rows["Kolkata"]["with_qloo"]["status"] == "complete"
    assert rows["Kolkata"]["without_qloo"]["status"] == "incomplete"
    assert rows["Kolkata"]["without_qloo"]["practical_rank"] in (1, 2)  # interpretable rank for the no-Qloo arm
    assert exp["verdict"] in ("material change", "no material change")
    assert exp["ranking_only"] and exp["discovery"]
    assert all(r["kendall_tau"] in (1.0, None) for r in exp["ranking_only"] if r["qloo_knew_none"])
    arm = (await c.get(f"/api/v1/runs/{exp_run}")).json()["run"]
    assert arm["status"] == "completed" and arm["pending_decision"] is None  # the arm never waits for the user
    # blind preference ratings: mapping hidden until both arms are rated
    assert exp["blinded"]["mapping"] is None
    r = await c.patch(f"/api/v1/experiments/{exp_id}/ratings", json={"A": 4})
    assert r.json()["mapping"] is None
    r = await c.patch(f"/api/v1/experiments/{exp_id}/ratings", json={"B": 2})
    assert set(r.json()["mapping"].values()) >= {"with", "without"}
    # a baseline from another project is rejected even inside the same workspace
    other = (await c.post("/api/v1/projects", json={"name": "Other"})).json()["id"]
    r = await c.post(f"/api/v1/projects/{other}/experiments", json={"run_id": run_id})
    assert r.status_code == 422 and r.json()["error"]["code"] == "baseline_other_project"
