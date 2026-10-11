"""Research runs, events (SSE + polling), places/analytics, comparison,
evidence, placements, strategies, consultation, revisions and experiments."""
from __future__ import annotations

import asyncio
import json
import math
import uuid
from datetime import UTC, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, Request
from geoalchemy2.shape import to_shape
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from ..config import settings
from ..db import SessionLocal, get_session
from ..errors import AppError
from ..models import (
    Audience, AudienceVersion, CampaignResult, ConsultMessage, ConstraintVersion, EvidenceRecord, Experiment,
    GeographicArea, Job, LocationAssessment, Place, PlacementCandidate, ProductFeature, ProductVersion, Revision,
    ResearchRun, RunEvent, StrategyVersion,
)
from ..providers import llm, qloo
from ..providers.base import ProviderError
from ..security import Principal, current_principal, require_editor
from ..services import context as ctxsvc
from ..services import costs, evidence as evsvc, hashing, jobs, revisions
from . import schemas as S
from .deps import (
    check_project, consult_limiter, costly_limiter, job_out, num, owned, placement_out, point, run_out, strategy_out,
)

router = APIRouter(prefix="/api/v1")


# ---------------------------------------------------------------- runs -------
async def start_run(s: AsyncSession, p: Principal, project_id: uuid.UUID, *, qloo_enabled: bool = True, label: str = "",
                    idem: str | None = None) -> tuple[ResearchRun, Job]:
    ctx = await ctxsvc.load(project_id)
    if not ctx["constraints"] or not ctx["product"]:
        raise AppError(409, "not_ready", "Save the product brief and launch constraints before starting research.")
    prev = (await s.execute(select(ResearchRun).where(ResearchRun.project_id == project_id, ResearchRun.qloo_enabled.is_(True))
                            .order_by(ResearchRun.created_at.desc()).limit(1))).scalar_one_or_none()
    prev_sel = []
    if prev and prev.selections.get("targets"):
        # carry forward selections by area name and audience lineage, so a revision keeps the user's choices
        for t in prev.selections["targets"]:
            av = await s.get(AudienceVersion, uuid.UUID(t["audience_version_id"]))
            cur = next((a for a in ctx["audiences"] if av and a["audience_id"] == str(av.audience_id)), None)
            if cur:
                prev_sel.append({"area_id": t["area_id"], "audience_version_id": cur["id"]})
    run_id = uuid.uuid4()
    run = ResearchRun(id=run_id, project_id=project_id, workspace_id=p.workspace_id, thread_id=f"run-{run_id}",
                      status="queued", qloo_enabled=qloo_enabled, experiment_label=label,
                      product_version_id=uuid.UUID(ctx["product"]["id"]), constraint_version_id=uuid.UUID(ctx["constraints"]["id"]),
                      previous_run_id=prev.id if prev else None, started_by=p.user_id,
                      input_snapshot={**{k: ctx[k] for k in ctxsvc.SNAPSHOT_KEYS},
                                      "previous_selections": prev_sel, "runtime": ctxsvc.runtime_info(),
                                      "snapshot_at": datetime.now(UTC).isoformat()},
                      input_hash=hashing.research_hash(ctx["constraints"]["hash"], [a["hash"] for a in ctx["audiences"]],
                                                       qloo_enabled, [e["qloo_id"] or "" for e in ctx["entities"]]))
    s.add(run)
    await s.commit()
    job, _ = await jobs.enqueue(workspace_id=p.workspace_id, project_id=project_id, run_id=run.id, kind="workflow",
                                payload={"run_id": str(run.id)}, idempotency_key=idem or f"run:{run.id}",
                                created_by=p.user_id, deadline_s=6 * 3600)
    return run, job


@router.post("/projects/{project_id}/research-runs", tags=["research"], status_code=202)
async def create_run(project_id: uuid.UUID, body: S.RunIn, p: Principal = Depends(require_editor),
                     s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    costly_limiter.check(str(p.user_id))
    run, job = await start_run(s, p, project_id, qloo_enabled=body.qloo_enabled, label=body.label, idem=body.idempotency_key)
    return {"run": run_out(run), "job": job_out(job)}


@router.get("/projects/{project_id}/research-runs", tags=["research"])
async def list_runs(project_id: uuid.UUID, p: Principal = Depends(current_principal), s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    # experiment comparison arms are listed after real runs, so "latest run" means the latest real one
    rows = (await s.execute(select(ResearchRun).where(ResearchRun.project_id == project_id)
                            .order_by((ResearchRun.experiment_label != "").asc(), ResearchRun.created_at.desc())
                            .limit(50))).scalars().all()
    return {"items": [run_out(r) for r in rows]}


def assessment_out(la: LocationAssessment, area: GeographicArea) -> dict:
    return {"id": str(la.id), "area_id": str(la.area_id), "area_name": area.name, "center": point(area.center),
            "radius_m": num(area.radius_m), "eligible": la.eligible, "status": la.status,
            "hard_constraints": la.hard_constraints, "components": la.components, "weights": la.weights,
            "practical_index": num(la.practical_index), "cultural_index": num(la.cultural_index),
            "planning_index": num(la.planning_index), "available_weight": num(la.available_weight),
            "evidence_coverage": num(la.evidence_coverage), "rank": la.rank,
            "assumptions": la.assumptions, "limitations": la.limitations, "evidence_ids": la.evidence_ids}


@router.get("/runs/{run_id}", tags=["research"])
async def get_run(run_id: uuid.UUID, p: Principal = Depends(current_principal), s: AsyncSession = Depends(get_session)):
    run = await owned(s, p, ResearchRun, run_id)
    rows = (await s.execute(select(LocationAssessment, GeographicArea).join(GeographicArea, GeographicArea.id == LocationAssessment.area_id)
                            .where(LocationAssessment.run_id == run_id))).all()
    assessments = [assessment_out(la, a) for la, a in rows]
    for x in assessments:
        x["practical_rank"] = None
    elig = sorted([x for x in assessments if x["eligible"] and x["practical_index"] is not None], key=lambda x: -x["practical_index"])
    for i, x in enumerate(elig, 1):
        x["practical_rank"] = i
    jobs_rows = (await s.execute(select(Job).where(Job.run_id == run_id).order_by(Job.created_at.desc()).limit(10))).scalars().all()
    strategies = (await s.execute(select(StrategyVersion).where(StrategyVersion.run_id == run_id))).scalars().all()
    return {"run": run_out(run), "assessments": sorted(assessments, key=lambda x: (x["rank"] is None, x["rank"] or 0, -(x["planning_index"] or 0))),
            "jobs": [job_out(j) for j in jobs_rows], "strategy_ids": [str(sv.id) for sv in strategies]}


@router.post("/runs/{run_id}/resume", tags=["research"], status_code=202)
async def resume_run(run_id: uuid.UUID, body: S.ResumeIn, p: Principal = Depends(require_editor),
                     s: AsyncSession = Depends(get_session)):
    run = await owned(s, p, ResearchRun, run_id)
    if run.status != "waiting_for_user" or not run.pending_decision:
        raise AppError(409, "not_waiting", "This run is not waiting for a decision.")
    dtype = run.pending_decision.get("type")
    d = body.decision
    if dtype == "creative_scope" and d.get("approve"):
        cap = Decimal(str(d.get("cap_usd") or 0))
        if cap <= 0 or cap > Decimal("30"):
            raise AppError(422, "invalid_cap", "Set a spending cap between $0.01 and $30.")
        if p.is_demo and not settings.DEMO_GENERATION_ENABLED:
            raise AppError(403, "demo_generation_disabled", "Generation is disabled for the public demo workspace.")
    run.status, run.pending_decision = "queued", None
    # close the job that stopped at the interrupt
    for j in (await s.execute(select(Job).where(Job.run_id == run_id, Job.status == "waiting_for_user"))).scalars().all():
        j.status = "completed"
    await s.commit()
    job, _ = await jobs.enqueue(workspace_id=p.workspace_id, project_id=run.project_id, run_id=run.id, kind="workflow",
                                payload={"run_id": str(run.id), "resume": d}, created_by=p.user_id, deadline_s=6 * 3600,
                                idempotency_key=f"resume:{run.id}:{hashing.stable_hash(d)[:16]}:{uuid.uuid4().hex[:6]}")
    return {"run": run_out(run), "job": job_out(job)}


@router.post("/runs/{run_id}/cancel", tags=["research"])
async def cancel_run(run_id: uuid.UUID, p: Principal = Depends(require_editor), s: AsyncSession = Depends(get_session)):
    run = await owned(s, p, ResearchRun, run_id)
    states = []
    for j in (await s.execute(select(Job).where(Job.run_id == run_id, Job.status.notin_(jobs.TERMINAL)))).scalars().all():
        states.append(await jobs.request_cancel(j.id))
    async with SessionLocal() as s2:
        r = await s2.get(ResearchRun, run_id)
        if r.status in ("waiting_for_user", "queued"):
            r.status = "cancelled"
        await s2.commit()
    return {"run_id": str(run.id), "jobs": states,
            "note": "No new paid calls will start. Requests already submitted to a provider may still be billed."}


# ---------------------------------------------------------------- events -----
@router.get("/runs/{run_id}/events", tags=["events"])
async def run_events(run_id: uuid.UUID, request: Request, after: int = 0, p: Principal = Depends(current_principal),
                     s: AsyncSession = Depends(get_session)):
    run = await owned(s, p, ResearchRun, run_id)
    last = int(request.headers.get("last-event-id") or after or 0)
    project_id = run.project_id

    async def gen():
        nonlocal last
        idle = 0
        while True:
            if await request.is_disconnected():
                break
            async with SessionLocal() as s2:
                rows = (await s2.execute(select(RunEvent).where(RunEvent.project_id == project_id, RunEvent.id > last,
                                                                RunEvent.workspace_id == p.workspace_id)
                                         .order_by(RunEvent.id).limit(100))).scalars().all()
            for e in rows:
                last = e.id
                yield {"id": str(e.id), "event": e.type, "data": json.dumps(_event_out(e))}
            idle = 0 if rows else idle + 1
            await asyncio.sleep(1.0 if rows else 1.5)
    return EventSourceResponse(gen(), ping=15)


def _event_out(e: RunEvent) -> dict:
    return {"id": e.id, "type": e.type, "stage": e.stage, "message": e.message, "data": e.data,
            "run_id": str(e.run_id) if e.run_id else None, "job_id": str(e.job_id) if e.job_id else None,
            "created_at": e.created_at.isoformat()}


@router.get("/projects/{project_id}/events", tags=["events"])
async def poll_events(project_id: uuid.UUID, after: int = 0, limit: int = 100, p: Principal = Depends(current_principal),
                      s: AsyncSession = Depends(get_session)):
    """Polling fallback for clients without SSE."""
    await check_project(s, p, project_id)
    rows = (await s.execute(select(RunEvent).where(RunEvent.project_id == project_id, RunEvent.id > after)
                            .order_by(RunEvent.id).limit(min(limit, 500)))).scalars().all()
    return {"items": [_event_out(e) for e in rows], "last_id": rows[-1].id if rows else after}


@router.get("/projects/{project_id}/event-stream", tags=["events"])
async def project_stream(project_id: uuid.UUID, request: Request, after: int = 0, p: Principal = Depends(current_principal),
                         s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    last = int(request.headers.get("last-event-id") or after or 0)
    if last == 0:
        last = (await s.execute(select(func.coalesce(func.max(RunEvent.id), 0)).where(RunEvent.project_id == project_id))).scalar_one()

    async def gen():
        nonlocal last
        while not await request.is_disconnected():
            async with SessionLocal() as s2:
                rows = (await s2.execute(select(RunEvent).where(RunEvent.project_id == project_id, RunEvent.id > last)
                                         .order_by(RunEvent.id).limit(100))).scalars().all()
            for e in rows:
                last = e.id
                yield {"id": str(e.id), "event": "message", "data": json.dumps(_event_out(e))}
            await asyncio.sleep(1.0 if rows else 1.5)
    return EventSourceResponse(gen(), ping=15)


# ---------------------------------------------------------------- places -----
def place_out(pl: Place) -> dict:
    pt = to_shape(pl.geom)
    return {"id": str(pl.id), "area_id": str(pl.area_id), "provider": pl.provider, "provider_id": pl.provider_id,
            "name": pl.name, "category": pl.category, "role": pl.role, "role_basis": pl.role_basis,
            "address": pl.address, "lat": round(pt.y, 6), "lon": round(pt.x, 6), "distance_m": num(pl.distance_m),
            "accessibility": pl.accessibility, "metadata": pl.metadata_, "retrieved_at": pl.retrieved_at.isoformat(),
            "evidence_id": str(pl.evidence_id) if pl.evidence_id else None}


def _place_filters(run_id, area_id, category, role, bbox):
    conds = [Place.run_id == run_id]
    if area_id:
        conds.append(Place.area_id == area_id)
    if category:
        conds.append(Place.category.in_(category.split(",")))
    if role:
        conds.append(Place.role.in_(role.split(",")))
    if bbox:
        try:
            w, so, e, n = [float(x) for x in bbox.split(",")]
        except ValueError:
            raise AppError(422, "bad_bbox", "bbox must be west,south,east,north") from None
        conds.append(func.ST_Intersects(Place.geom, func.ST_MakeEnvelope(w, so, e, n, 4326)))
    return and_(*conds)


@router.get("/runs/{run_id}/places", tags=["research"])
async def run_places(run_id: uuid.UUID, area_id: uuid.UUID | None = None, category: str | None = None, role: str | None = None,
                     bbox: str | None = None, page: int = 1, page_size: int = 200, p: Principal = Depends(current_principal),
                     s: AsyncSession = Depends(get_session)):
    await owned(s, p, ResearchRun, run_id)
    page_size = max(1, min(page_size, 500))
    cond = _place_filters(run_id, area_id, category, role, bbox)
    total = (await s.execute(select(func.count()).select_from(Place).where(cond))).scalar_one()
    rows = (await s.execute(select(Place).where(cond).order_by(Place.distance_m).offset((page - 1) * page_size)
                            .limit(page_size))).scalars().all()
    return {"items": [place_out(x) for x in rows], "total": total, "page": page, "page_size": page_size,
            "note": "Retrieved set only (bounded radius, named features); not a census of businesses.",
            "attribution": "© OpenStreetMap contributors"}


@router.get("/runs/{run_id}/analytics", tags=["research"])
async def run_analytics(run_id: uuid.UUID, area_id: uuid.UUID | None = None, category: str | None = None,
                        role: str | None = None, bbox: str | None = None, p: Principal = Depends(current_principal),
                        s: AsyncSession = Depends(get_session)):
    """All chart data computed from the same filtered place set as /places."""
    run = await owned(s, p, ResearchRun, run_id)
    cond = _place_filters(run_id, area_id, category, role, bbox)
    areas = {a.id: a for a in (await s.execute(select(GeographicArea).where(GeographicArea.project_id == run.project_id))).scalars().all()}
    cat_rows = (await s.execute(select(Place.area_id, Place.category, Place.role, Place.role_basis, func.count())
                                .where(cond).group_by(Place.area_id, Place.category, Place.role, Place.role_basis))).all()
    dist: dict[str, dict] = {}
    comp: dict[str, dict] = {}
    for aid, cat, rl, basis, n in cat_rows:
        name = areas[aid].name if aid in areas else str(aid)
        dist.setdefault(name, {})[cat] = dist.get(name, {}).get(cat, 0) + n
        if rl == "competitor":
            c = comp.setdefault(name, {"confirmed": 0, "inferred_category_peers": 0})
            c["confirmed" if basis == "confirmed" else "inferred_category_peers"] += n
    density = []
    for aid, a in areas.items():
        if a.name in comp and a.radius_m:
            km2 = math.pi * (float(a.radius_m) / 1000) ** 2
            total = comp[a.name]["confirmed"] + comp[a.name]["inferred_category_peers"]
            density.append({"area": a.name, "per_100_km2": round(total / km2 * 100, 2), "area_km2": round(km2, 1),
                            "count": total})
    las = (await s.execute(select(LocationAssessment).where(LocationAssessment.run_id == run_id))).scalars().all()
    evs = (await s.execute(select(EvidenceRecord).where(EvidenceRecord.run_id == run_id))).scalars().all()
    topics = ("places", "climate", "taste", "service", "noise", "footfall", "income", "accessibility", "ad_inventory")
    coverage = []
    for aid, a in areas.items():
        if not any(la.area_id == aid for la in las):
            continue
        row = {"area": a.name}
        for t in topics:
            kinds = {e.kind for e in evs if e.area_id == aid and e.topic == t}
            row[t] = ("supported" if kinds & {"observed_fact", "provider_signal", "derived_metric"} else
                      "hypothesis" if "hypothesis" in kinds else "unknown")
        coverage.append(row)
    ctx = await ctxsvc.load(run.project_id)
    feats = [f for f in (ctx["product"] or {}).get("features", []) if f["enabled"]]
    matrix = []
    for aid, a in areas.items():
        if not any(la.area_id == aid for la in las):
            continue
        for f in feats:
            hyp = next((e for e in evs if e.area_id == aid and e.topic == "feature_relevance"
                        and ((e.scope or {}).get("feature_key") or "fan") == f["key"]), None)
            if hyp:
                status, note, eid = "hypothesis", hyp.statement, str(hyp.id)
            elif f["key"] == "speech_amplification":
                status, note, eid = "unknown", "No measured noise or intelligibility data; relevance cannot be validated.", None
            else:
                status, note, eid = "unknown", "No location evidence bears on this feature.", None
            matrix.append({"area": a.name, "feature": f["name"], "feature_key": f["key"], "status": status, "note": note,
                           "evidence_id": eid})
    taste = [{"area": areas[e.area_id].name if e.area_id in areas else "", "title": e.title, "value": num(e.value_numeric),
              "units": e.units, "top": (e.payload or {}).get("top", [])[:8], "evidence_id": str(e.id)}
             for e in evs if e.kind == "provider_signal" and e.topic == "taste"]
    comparison = [{"area": areas[la.area_id].name, "eligible": la.eligible, "status": la.status,
                   "planning_index": num(la.planning_index), "available_weight": num(la.available_weight),
                   "components": {k: {"normalized": v.get("normalized"), "weight": v.get("weight"), "state": v.get("state"),
                                      "raw": v.get("raw"), "label": v.get("label")} for k, v in (la.components or {}).items()}}
                  for la in las if la.area_id in areas]
    total_places = (await s.execute(select(func.count()).select_from(Place).where(cond))).scalar_one()
    return {"filters": {"area_id": str(area_id) if area_id else None, "category": category, "role": role, "bbox": bbox},
            "total_places": total_places, "category_distribution": dist, "competitors": comp, "competitor_density": density,
            "taste_profile": taste, "evidence_coverage": coverage, "feature_relevance": matrix, "location_comparison": comparison,
            "caveats": {"counts": "Counts are limited to the retrieved set (named OSM features within the radius, capped).",
                        "competitors": "Inferred category peers are shops whose tags indicate mobility/medical supplies; "
                                       "they are not confirmed competitors.",
                        "density": "Density uses the disclosed circular area; OSM completeness varies by city.",
                        "taste": "Qloo affinity is a relative taste signal, not demand or willingness to partner.",
                        "coverage": "Unknown means no evidence; it is not zero."}}


@router.get("/runs/{run_id}/taste-layer", tags=["research"])
async def taste_layer(run_id: uuid.UUID, area_id: uuid.UUID, audience_version_id: uuid.UUID,
                      p: Principal = Depends(current_principal), s: AsyncSession = Depends(get_session)):
    run = await owned(s, p, ResearchRun, run_id)
    if not qloo.configured():
        return {"available": False, "reason": "Qloo is not configured (QLOO_API_KEY missing)."}
    area = await s.get(GeographicArea, area_id)
    if area is None or area.project_id != run.project_id:
        raise AppError(404, "not_found", "Area not found in this run's project.")
    from ..services.research import signals_for
    ents, tags = await signals_for(run.project_id, str(audience_version_id))
    if not ents and not tags:
        return {"available": False, "reason": "This audience has no resolved Qloo entities or tags."}
    c = to_shape(area.center)
    try:
        pts, meta = await qloo.heatmap(wkt=f"POINT({c.x:.5f} {c.y:.5f})", entity_ids=ents, tag_ids=tags)
    except ProviderError as e:
        return {"available": False, "reason": e.message}
    return {"available": True, "points": pts[:2000],
            "label": {"entity_type": "urn:heatmap (grid points)", "signal": {"entities": ents, "tags": tags},
                      "metric": "affinity_rank (rank-normalised within this result set)",
                      "scale": "Qloo heatmap grid; relative within this query only",
                      "not": "Not demand, footfall, wheelchair need or general consumer demand."},
            "retrieved_at": meta.get("retrieved_at")}


@router.post("/projects/{project_id}/locations/compare", tags=["research"])
async def compare_locations(project_id: uuid.UUID, body: S.CompareIn, p: Principal = Depends(current_principal),
                            s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    run = await owned(s, p, ResearchRun, body.run_id)
    rows = (await s.execute(select(LocationAssessment, GeographicArea).join(GeographicArea, GeographicArea.id == LocationAssessment.area_id)
                            .where(LocationAssessment.run_id == run.id, LocationAssessment.area_id.in_(body.area_ids)))).all()
    items = [assessment_out(la, a) for la, a in rows]
    all_rows = (await s.execute(select(LocationAssessment).where(LocationAssessment.run_id == run.id))).scalars().all()
    ranked = sorted([x for x in all_rows if x.eligible and x.practical_index is not None], key=lambda x: -float(x.practical_index))
    prank = {str(x.area_id): i for i, x in enumerate(ranked, 1)}
    for it in items:
        it["practical_rank"] = prank.get(it["area_id"])
    return {"items": items, "comparable": len({x["status"] for x in items if x["eligible"]}) <= 1,
            "note": "Complete and incomplete results are not directly comparable; incomplete indices cover only the available weight."}


# ---------------------------------------------------------------- evidence ---
@router.get("/projects/{project_id}/evidence", tags=["evidence"])
async def list_evidence(project_id: uuid.UUID, run_id: uuid.UUID | None = None, area_id: uuid.UUID | None = None,
                        ids: str | None = None, kind: str | None = None, p: Principal = Depends(current_principal),
                        s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    q = select(EvidenceRecord).where(EvidenceRecord.project_id == project_id)
    if run_id:
        q = q.where(EvidenceRecord.run_id == run_id)
    if area_id:
        q = q.where(EvidenceRecord.area_id == area_id)
    if kind:
        q = q.where(EvidenceRecord.kind.in_(kind.split(",")))
    if ids:
        try:
            q = q.where(EvidenceRecord.id.in_([uuid.UUID(i) for i in ids.split(",") if i][:200]))
        except ValueError:
            raise AppError(422, "bad_ids", "ids must be UUIDs") from None
    rows = (await s.execute(q.order_by(EvidenceRecord.created_at.desc()).limit(500))).scalars().all()
    return {"items": [evsvc.to_card(e) for e in rows]}


@router.get("/evidence/{evidence_id}", tags=["evidence"])
async def get_evidence(evidence_id: uuid.UUID, diagnostics: bool = False, p: Principal = Depends(current_principal),
                       s: AsyncSession = Depends(get_session)):
    e = await owned(s, p, EvidenceRecord, evidence_id)
    card = evsvc.to_card(e)
    if diagnostics:
        card["payload"] = e.payload
    return card


# ---------------------------------------------------------------- placements -
@router.get("/projects/{project_id}/placements", tags=["placements"])
async def list_placements(project_id: uuid.UUID, run_id: uuid.UUID | None = None, area_id: uuid.UUID | None = None,
                          audience_version_id: uuid.UUID | None = None, shortlisted: bool | None = None,
                          p: Principal = Depends(current_principal), s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    if run_id is None:
        run_id = (await s.execute(select(ResearchRun.id).where(ResearchRun.project_id == project_id, ResearchRun.qloo_enabled.is_(True))
                                  .order_by(ResearchRun.created_at.desc()).limit(1))).scalar_one_or_none()
    q = select(PlacementCandidate).where(PlacementCandidate.project_id == project_id, PlacementCandidate.run_id == run_id)
    if area_id:
        q = q.where(PlacementCandidate.area_id == area_id)
    if audience_version_id:
        q = q.where(PlacementCandidate.audience_version_id == audience_version_id)
    if shortlisted is not None:
        q = q.where(PlacementCandidate.shortlisted.is_(shortlisted))
    rows = (await s.execute(q.order_by(PlacementCandidate.suitability_score.desc().nullslast()).limit(500))).scalars().all()
    return {"items": [placement_out(x) for x in rows], "run_id": str(run_id) if run_id else None,
            "legend": {"candidate": "Identified, nothing verified", "availability_unknown": "Place exists; ad availability unknown",
                       "verified_opportunity": "Owner verified permission, dates and cost", "rejected": "Ruled out"}}


@router.patch("/placements/{placement_id}", tags=["placements"])
async def patch_placement(placement_id: uuid.UUID, body: S.PlacementPatch, p: Principal = Depends(require_editor),
                          s: AsyncSession = Depends(get_session)):
    pc = await owned(s, p, PlacementCandidate, placement_id)
    data = body.model_dump(exclude_none=True)
    if "verification" in data:
        pc.verification = {**(pc.verification or {}), **data.pop("verification")}
    for k, v in data.items():
        setattr(pc, k, v)
    if pc.status == "verified_opportunity":
        missing = [k for k in ("availability", "permission", "contact", "cost", "dates") if (pc.verification or {}).get(k) != "verified"]
        if missing:
            raise AppError(422, "not_verified", f"Mark {', '.join(missing)} as verified before calling this a verified opportunity.")
    await s.commit()
    return placement_out(pc)


# ---------------------------------------------------------------- strategies -
@router.get("/projects/{project_id}/strategies", tags=["strategies"])
async def list_strategies(project_id: uuid.UUID, include_stale: bool = True, p: Principal = Depends(current_principal),
                          s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    q = select(StrategyVersion).where(StrategyVersion.project_id == project_id).order_by(StrategyVersion.created_at.desc())
    if not include_stale:
        q = q.where(StrategyVersion.stale.is_(False))
    return {"items": [strategy_out(x) for x in (await s.execute(q)).scalars().all()]}


@router.get("/strategies/{strategy_id}", tags=["strategies"])
async def get_strategy(strategy_id: uuid.UUID, p: Principal = Depends(current_principal), s: AsyncSession = Depends(get_session)):
    sv = await owned(s, p, StrategyVersion, strategy_id)
    ev = (await s.execute(select(EvidenceRecord).where(EvidenceRecord.id.in_([uuid.UUID(i) for i in sv.evidence_ids])))).scalars().all() if sv.evidence_ids else []
    pids = [uuid.UUID(x["placement_id"]) for x in sv.content.get("placement_options", []) + sv.content.get("partner_shortlist", [])]
    pls = (await s.execute(select(PlacementCandidate).where(PlacementCandidate.id.in_(pids)))).scalars().all() if pids else []
    return {**strategy_out(sv), "evidence": [evsvc.to_card(e) for e in ev], "placements": [placement_out(x) for x in pls]}


@router.post("/projects/{project_id}/strategies", tags=["strategies"], status_code=202)
async def create_strategy(project_id: uuid.UUID, body: S.StrategyIn, p: Principal = Depends(require_editor),
                          s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    run = await owned(s, p, ResearchRun, body.run_id)
    job, created = await jobs.enqueue(workspace_id=p.workspace_id, project_id=project_id, run_id=run.id, kind="strategy",
                                      payload={"run_id": str(run.id), "area_id": str(body.area_id),
                                               "audience_version_id": str(body.audience_version_id), "force": body.force},
                                      idempotency_key=f"strategy:{run.id}:{body.area_id}:{body.audience_version_id}:{body.force}:{uuid.uuid4().hex[:6] if body.force else ''}",
                                      created_by=p.user_id)
    return {"job": job_out(job), "created": created}


# ---------------------------------------------------------------- consult ----
class _Proposal(BaseModel):
    kind: str = Field(description="exclude_region | set_ad_budget | disable_feature | enable_feature | change_audience_role | none")
    region_name: str | None = None
    ad_spend_budget: float | None = None
    feature_key: str | None = None
    audience_name: str | None = None
    role: str | None = None
    rationale: str = ""


class _Answer(BaseModel):
    answer: str
    evidence_ids: list[str] = Field(default_factory=list)
    hypotheses: list[str] = Field(default_factory=list)
    unknowns: list[str] = Field(default_factory=list)
    proposed_revision: _Proposal | None = None


@router.post("/projects/{project_id}/consult", tags=["consult"])
async def consult(project_id: uuid.UUID, body: S.ConsultIn, p: Principal = Depends(current_principal),
                  s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    consult_limiter.check(str(p.user_id))
    run_id = body.run_id or (await s.execute(select(ResearchRun.id).where(ResearchRun.project_id == project_id)
                                             .order_by(ResearchRun.created_at.desc()).limit(1))).scalar_one_or_none()
    ctx = await ctxsvc.load(project_id)
    evs = (await s.execute(select(EvidenceRecord).where(EvidenceRecord.run_id == run_id).limit(120))).scalars().all() if run_id else []
    las = (await s.execute(select(LocationAssessment, GeographicArea).join(GeographicArea, GeographicArea.id == LocationAssessment.area_id)
                           .where(LocationAssessment.run_id == run_id))).all() if run_id else []
    history = (await s.execute(select(ConsultMessage).where(ConsultMessage.project_id == project_id)
                               .order_by(ConsultMessage.created_at.desc()).limit(6))).scalars().all()
    ev_txt = "\n".join(f"- id={e.id} [{e.kind}] {e.title}: {e.statement[:240]}" for e in evs)
    la_txt = "\n".join(f"- {a.name}: eligible={la.eligible} status={la.status} planning_index={la.planning_index} "
                       f"available_weight={la.available_weight} hard={[(h['name'], h['result']) for h in la.hard_constraints]}"
                       for la, a in las)
    hist_txt = "\n".join(f"{m.role}: {m.content[:400]}" for m in reversed(history))
    system = ("You are a launch-strategy consultant. Answer only from the evidence and assessments given; say clearly "
              "what is unknown. Separate hypotheses from supported facts. Cite evidence ids. If the user asks to change a "
              "constraint (exclude a city, change the budget, remove a feature, change an audience's buyer role), propose "
              "it in proposed_revision; never claim it was applied.")
    user = (f"<data>\nPRODUCT: {(ctx['product'] or {}).get('name')}; features: "
            f"{[(f['key'], f['enabled']) for f in (ctx['product'] or {}).get('features', [])]}\n"
            f"AUDIENCES: {[(a['name'], a['role']) for a in ctx['audiences']]}\nASSESSMENTS:\n{la_txt}\nEVIDENCE:\n{ev_txt}\n"
            f"RECENT CONVERSATION:\n{hist_txt}\n</data>\nQUESTION: {body.message}")
    usage = llm.Usage("openai", "")
    try:
        ans, model = await llm.structured(_Answer, system, user, usage=usage, max_tokens=1500)
    except ProviderError as e:
        raise AppError(503, "reasoning_unavailable", f"Consultation is unavailable: {e.message}", retryable=e.retryable) from None
    valid, invalid = await evsvc.validate_refs(s, project_id, ans.evidence_ids)
    prop = ans.proposed_revision.model_dump() if ans.proposed_revision and ans.proposed_revision.kind != "none" else None
    s.add(ConsultMessage(project_id=project_id, user_id=p.user_id, role="user", content=body.message))
    msg = ConsultMessage(project_id=project_id, role="assistant", content=ans.answer, evidence_ids=valid,
                         proposed_revision=prop, model=model)
    s.add(msg)
    await s.commit()
    await costs.record(workspace_id=p.workspace_id, project_id=project_id, provider=usage.provider, model=usage.model,
                       operation="consult", category="reasoning", quantity=usage.input_tokens / 1000, unit="1k_input_tokens",
                       actual_usd=llm.cost_of(usage))
    cards = [evsvc.to_card(e) for e in evs if str(e.id) in valid]
    return {"answer": ans.answer, "evidence": cards, "hypotheses": ans.hypotheses, "unknowns": ans.unknowns,
            "proposed_revision": prop, "dropped_evidence_ids": invalid, "model": model}


@router.get("/projects/{project_id}/consult", tags=["consult"])
async def consult_history(project_id: uuid.UUID, p: Principal = Depends(current_principal), s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    rows = (await s.execute(select(ConsultMessage).where(ConsultMessage.project_id == project_id)
                            .order_by(ConsultMessage.created_at).limit(200))).scalars().all()
    return {"items": [{"role": m.role, "content": m.content, "evidence_ids": m.evidence_ids, "proposed_revision": m.proposed_revision,
                       "created_at": m.created_at.isoformat()} for m in rows]}


# ---------------------------------------------------------------- revisions --
@router.get("/projects/{project_id}/revisions", tags=["revisions"])
async def list_revisions(project_id: uuid.UUID, p: Principal = Depends(current_principal), s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    rows = (await s.execute(select(Revision).where(Revision.project_id == project_id).order_by(Revision.created_at.desc()).limit(100))).scalars().all()
    return {"items": [{"id": str(r.id), "kind": r.kind, "summary": r.summary, "before": r.before, "after": r.after,
                       "invalidated": r.invalidated, "preserved": r.preserved, "run_id": str(r.run_id) if r.run_id else None,
                       "created_at": r.created_at.isoformat()} for r in rows]}


@router.post("/projects/{project_id}/revisions/apply", tags=["revisions"], status_code=202)
async def apply_revision(project_id: uuid.UUID, body: S.RevisionApplyIn, p: Principal = Depends(require_editor),
                         s: AsyncSession = Depends(get_session)):
    """Apply a common revision as a new version, then (optionally) re-run.
    Previous versions and results are preserved."""
    await check_project(s, p, project_id)
    result: dict = {}
    if body.kind in ("exclude_region", "set_ad_budget"):
        prev = await ctxsvc.latest_constraints(s, project_id)
        if prev is None:
            raise AppError(409, "no_constraints", "No constraints to revise.")
        before = ctxsvc.constraint_dict(prev)
        cv = ConstraintVersion(project_id=project_id, version=prev.version + 1, country_code=prev.country_code,
                               candidate_regions=prev.candidate_regions, service_regions=prev.service_regions,
                               excluded_regions=list(prev.excluded_regions), production_budget=prev.production_budget,
                               ad_spend_budget=prev.ad_spend_budget, currency=prev.currency,
                               min_ad_spend_per_location=prev.min_ad_spend_per_location,
                               distribution_requirements=prev.distribution_requirements, weights=prev.weights)
        if body.kind == "exclude_region":
            if not body.region_name or not any(r["name"].lower() == body.region_name.lower() for r in prev.candidate_regions):
                raise AppError(422, "unknown_region", "Name one of the candidate locations.")
            cv.excluded_regions = [*cv.excluded_regions, {"name": body.region_name}]
            cv.change_note = f"Excluded {body.region_name}"
        else:
            cv.ad_spend_budget = body.ad_spend_budget
            cv.change_note = f"Ad budget set to {body.ad_spend_budget}"
        s.add(cv)
        await s.flush()
        cv.content_hash = hashing.constraint_hash(cv)
        await s.commit()
        result = await revisions.constraints_changed(project_id, p.user_id, before, ctxsvc.constraint_dict(cv))
    elif body.kind in ("disable_feature", "enable_feature"):
        prev = await ctxsvc.latest_product(s, project_id)
        if not prev or not any(f.key == body.feature_key for f in prev.features):
            raise AppError(422, "unknown_feature", "Name an existing feature key.")
        before = ctxsvc.product_dict(prev)
        cols = {c: getattr(prev, c) for c in ("name", "description", "category", "price", "currency", "intended_benefits",
                                               "operating_limitations", "launch_date", "distribution_options", "available_stock",
                                               "brand_colours", "brand_voice", "website", "cta_destination", "open_questions",
                                               "is_synthetic", "source")}
        pv = ProductVersion(project_id=project_id, version=prev.version + 1, **cols,
                            change_note=f"{'Disabled' if body.kind == 'disable_feature' else 'Enabled'} {body.feature_key}")
        pv.features = [ProductFeature(position=f.position, key=f.key, name=f.name, mechanism=f.mechanism,
                                      proposed_benefit=f.proposed_benefit, operating_conditions=f.operating_conditions,
                                      evidence_status=f.evidence_status, source=f.source,
                                      prohibited_exaggerations=f.prohibited_exaggerations, critical_unknowns=f.critical_unknowns,
                                      enabled=(body.kind == "enable_feature") if f.key == body.feature_key else f.enabled)
                       for f in prev.features]
        s.add(pv)
        await s.flush()
        pv.content_hash = hashing.product_hash(pv)
        from ..models import Claim
        enabled = {f.key for f in pv.features if f.enabled}
        for c in (await s.execute(select(Claim).where(Claim.product_version_id == prev.id))).scalars().all():
            if c.feature_key is None or c.feature_key in enabled:
                s.add(Claim(project_id=project_id, product_version_id=pv.id, feature_key=c.feature_key, text=c.text,
                            support_status=c.support_status, approved=c.approved, evidence_ids=c.evidence_ids))
        await s.commit()
        result = await revisions.product_changed(project_id, p.user_id, before, ctxsvc.product_dict(pv))
    elif body.kind == "change_audience_role":
        aud = await owned(s, p, Audience, body.audience_id) if body.audience_id else None
        if aud is None or body.role is None:
            raise AppError(422, "audience_required", "Give the audience id and the new role.")
        prev = (await s.execute(select(AudienceVersion).where(AudienceVersion.audience_id == aud.id)
                                .order_by(AudienceVersion.version.desc()).limit(1))).scalar_one()
        av = AudienceVersion(audience_id=aud.id, project_id=project_id, version=prev.version + 1, name=prev.name, role=body.role,
                             description=prev.description, needs=prev.needs, voluntary_interests=prev.voluntary_interests,
                             languages=prev.languages, research_notes=prev.research_notes,
                             is_hypothetical_persona=prev.is_hypothetical_persona)
        s.add(av)
        await s.flush()
        av.content_hash = hashing.audience_hash(av)
        from ..models import ResolvedEntity
        for e in (await s.execute(select(ResolvedEntity).where(ResolvedEntity.audience_version_id == prev.id))).scalars().all():
            s.add(ResolvedEntity(project_id=project_id, audience_version_id=av.id, query_text=e.query_text, status=e.status,
                                 qloo_id=e.qloo_id, qloo_type=e.qloo_type, canonical_name=e.canonical_name, tags=e.tags,
                                 candidates=e.candidates, proxy_for=e.proxy_for, proxy_reason=e.proxy_reason))
        await s.commit()
        result = await revisions.audience_changed(project_id, p.user_id, ctxsvc.audience_dict(prev), ctxsvc.audience_dict(av))
    out = {"revision": result}
    if body.rerun:
        run, job = await start_run(s, p, project_id, idem=None)
        async with SessionLocal() as s2:
            if result.get("revision_id"):
                rv = await s2.get(Revision, uuid.UUID(result["revision_id"]))
                rv.run_id = run.id
                await s2.commit()
        out["run"], out["job"] = run_out(run), job_out(job)
    return out


@router.get("/runs/{run_id}/diff", tags=["revisions"])
async def run_diff(run_id: uuid.UUID, against: uuid.UUID | None = None, p: Principal = Depends(current_principal),
                   s: AsyncSession = Depends(get_session)):
    run = await owned(s, p, ResearchRun, run_id)
    other_id = against or run.previous_run_id
    if other_id is None:
        return {"available": False, "reason": "No earlier run to compare with."}
    other = await owned(s, p, ResearchRun, other_id)

    async def la_map(rid):
        rows = (await s.execute(select(LocationAssessment, GeographicArea).join(GeographicArea, GeographicArea.id == LocationAssessment.area_id)
                                .where(LocationAssessment.run_id == rid))).all()
        return {a.name: la for la, a in rows}
    now, before = await la_map(run.id), await la_map(other.id)
    areas = []
    for name in sorted(set(now) | set(before)):
        a, b = now.get(name), before.get(name)
        areas.append({"area": name,
                      "before": {"eligible": b.eligible, "status": b.status, "planning_index": num(b.planning_index), "rank": b.rank} if b else None,
                      "after": {"eligible": a.eligible, "status": a.status, "planning_index": num(a.planning_index), "rank": a.rank} if a else None,
                      "changed": (not a or not b or a.eligible != b.eligible or a.rank != b.rank or a.status != b.status),
                      "why": [h["reason"] for h in (a.hard_constraints if a else []) if h["result"] == "fail"]})
    strat_now = (await s.execute(select(StrategyVersion).where(StrategyVersion.run_id == run.id))).scalars().all()
    revs = (await s.execute(select(Revision).where(Revision.project_id == run.project_id, Revision.created_at >= other.created_at,
                                                   Revision.created_at <= run.created_at).order_by(Revision.created_at))).scalars().all()
    events_ = (await s.execute(select(RunEvent).where(RunEvent.run_id == run.id, RunEvent.type == "run.strategy"))).scalars().all()
    return {"available": True, "run_id": str(run.id), "against": str(other.id), "areas": areas,
            "strategies": {"new_versions": [strategy_out(x)["id"] for x in strat_now],
                           "decisions": [e.data for e in events_]},
            "revisions": [{"kind": r.kind, "summary": r.summary, "invalidated": r.invalidated, "preserved": r.preserved} for r in revs],
            "inputs_changed": {"product_version": run.product_version_id != other.product_version_id,
                               "constraints_version": run.constraint_version_id != other.constraint_version_id}}


# ---------------------------------------------------------------- experiments
@router.post("/projects/{project_id}/experiments", tags=["experiments"], status_code=202)
async def create_experiment(project_id: uuid.UUID, body: S.ExperimentIn, p: Principal = Depends(require_editor),
                            s: AsyncSession = Depends(get_session)):
    """Start the no-Qloo arm from the baseline's immutable snapshot and its
    pinned practical evidence; later project edits cannot leak in."""
    from ..services import experiments
    await check_project(s, p, project_id)
    base = await owned(s, p, ResearchRun, body.run_id)
    try:
        await experiments.validate_baseline(project_id, base)
    except experiments.BaselineError as e:
        raise AppError(422, e.code, e.message) from None
    snap = experiments.experiment_snapshot(base)
    run_id = uuid.uuid4()
    run = ResearchRun(id=run_id, project_id=project_id, workspace_id=p.workspace_id, thread_id=f"run-{run_id}",
                      status="queued", qloo_enabled=False, experiment_label="without_qloo",
                      product_version_id=base.product_version_id, constraint_version_id=base.constraint_version_id,
                      previous_run_id=base.id, started_by=p.user_id,
                      input_snapshot={**snap, "runtime": ctxsvc.runtime_info(), "snapshot_at": datetime.now(UTC).isoformat()},
                      input_hash=base.input_hash)
    s.add(run)
    await s.flush()
    held = ["product version", "constraint version", "audience versions", "resolved Qloo signals",
            "practical evidence (copied from the baseline, not re-queried)", "candidate areas", "scoring weights"]
    ex = Experiment(project_id=project_id, run_with_qloo_id=base.id, run_without_qloo_id=run.id, conditions={
        "held_constant": held, "varied": "Qloo taste signals withheld (cultural component and Qloo-sourced places absent)",
        "baseline_run_id": str(base.id), "baseline_snapshot_at": snap.get("baseline_snapshot_at"),
        "product_version_id": str(base.product_version_id), "constraint_version_id": str(base.constraint_version_id),
        "runtime_baseline": (base.input_snapshot or {}).get("runtime"), "runtime_experiment": ctxsvc.runtime_info()},
        metrics={"blind": experiments.new_blind()})
    s.add(ex)
    await s.commit()
    job, _ = await jobs.enqueue(workspace_id=p.workspace_id, project_id=project_id, run_id=run.id, kind="workflow",
                                payload={"run_id": str(run.id)}, idempotency_key=f"run:{run.id}", created_by=p.user_id,
                                deadline_s=6 * 3600)
    return {"experiment_id": str(ex.id), "run": run_out(run), "job": job_out(job)}


@router.get("/experiments/{experiment_id}", tags=["experiments"])
async def get_experiment(experiment_id: uuid.UUID, p: Principal = Depends(current_principal), s: AsyncSession = Depends(get_session)):
    from ..services import experiments
    ex = await owned(s, p, Experiment, experiment_id)
    return await experiments.analyse(ex)


class _BlindRating(BaseModel):
    A: int | None = Field(default=None, ge=1, le=5)
    B: int | None = Field(default=None, ge=1, le=5)
    notes: str = Field(default="", max_length=1000)
    reveal: bool = False


@router.patch("/experiments/{experiment_id}/ratings", tags=["experiments"])
async def rate_experiment(experiment_id: uuid.UUID, body: _BlindRating, p: Principal = Depends(require_editor),
                          s: AsyncSession = Depends(get_session)):
    """Blind preference: rate shortlist A and B without knowing which used Qloo;
    the mapping is revealed once both are rated (or on explicit reveal)."""
    ex = await owned(s, p, Experiment, experiment_id)
    r = dict(ex.owner_ratings or {})
    for k in ("A", "B"):
        if getattr(body, k) is not None:
            r[k] = getattr(body, k)
    if body.notes:
        r["notes"] = body.notes
    if body.reveal or ("A" in r and "B" in r):
        r["revealed"] = True
    ex.owner_ratings = r
    await s.commit()
    blind = (ex.metrics or {}).get("blind") or {}
    return {"owner_ratings": r, "mapping": blind if r.get("revealed") else None}


@router.get("/projects/{project_id}/experiments", tags=["experiments"])
async def list_experiments(project_id: uuid.UUID, p: Principal = Depends(current_principal), s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    rows = (await s.execute(select(Experiment).where(Experiment.project_id == project_id).order_by(Experiment.created_at.desc()))).scalars().all()
    return {"items": [{"id": str(e.id), "run_with_qloo_id": str(e.run_with_qloo_id), "run_without_qloo_id": str(e.run_without_qloo_id),
                       "created_at": e.created_at.isoformat()} for e in rows]}


_ = (CampaignResult, ProductFeature)
