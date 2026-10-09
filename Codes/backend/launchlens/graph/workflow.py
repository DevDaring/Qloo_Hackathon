"""The principal LaunchLens workflow (LangGraph, Postgres-checkpointed).

intake_validator -> research_planner -> entity_resolver -> geographic_researcher
-> taste_analyst -> market_evaluator -> placement_researcher -> [select targets]
-> strategy_writer -> creative_planner -> [approve scope & cap] -> image_producer
-> video_producer -> quality_reviewer -> exporter

Nodes are focused steps; most are deterministic services and only a few call a
model. Business records live in the application tables; the checkpointer
(separate `langgraph` schema) holds only resumable execution state, keyed by
the run's stable thread id. Every node is idempotent against the database so
that replay after a crash reuses completed side effects. Decisions that belong
to the user are LangGraph interrupts; the worker turns them into
`waiting_for_user` and /runs/{id}/resume continues the same thread.
"""
from __future__ import annotations

import logging
import operator
import uuid
from typing import Annotated, Any, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt
from sqlalchemy import select

from ..config import settings
from ..db import session_scope
from ..models import Export, LocationAssessment, ResearchRun
from ..providers import qloo
from ..services import context as ctxsvc
from ..services import creative, events, exporter, production, research, strategy

log = logging.getLogger("launchlens.graph")


def _merge(a: dict | None, b: dict | None) -> dict:
    return {**(a or {}), **(b or {})}


class LaunchState(TypedDict, total=False):
    project_id: str
    run_id: str
    thread_id: str
    tenant_id: str
    product_version_id: str
    constraint_version_id: str
    audience_version_ids: list[str]
    qloo_enabled: bool
    intake: dict
    plan: dict
    entity_status: dict
    areas: list[dict]
    geo: dict
    taste: dict
    assessments: list[dict]
    placements: dict
    selections: list[dict]
    strategy_ids: list[str]
    creative_request: dict
    brief_ids: list[str]
    image_results: dict
    video_results: dict
    review: dict
    export_id: str
    remote_request_ids: Annotated[list[str], operator.add]
    stage_statuses: Annotated[dict, _merge]
    errors: Annotated[list[dict], operator.add]
    pending_decision: dict | None
    done: bool


def _ctx(config) -> production.JobCtx | None:
    return (config or {}).get("configurable", {}).get("job_ctx")


async def _stage(state: LaunchState, config, stage: str, status: str, message: str = "", **data) -> dict:
    run_id = uuid.UUID(state["run_id"])
    await research.set_run(run_id, stage_status=(stage, status), status="running")
    await events.emit(uuid.UUID(state["tenant_id"]), "run.stage", message or f"{stage}: {status}",
                      project_id=uuid.UUID(state["project_id"]), run_id=run_id, stage=stage, data={"status": status, **data})
    jc = _ctx(config)
    if jc:
        await jc.beat(status="running", stage=stage)
    return {"stage_statuses": {stage: status}}


# ---------------------------------------------------------------- nodes ------
async def intake_validator(state: LaunchState, config) -> dict:
    ctx = await ctxsvc.load(uuid.UUID(state["project_id"]))
    v = research.validate_intake(ctx)
    upd = await _stage(state, config, "intake_validator", "completed" if v["ok"] else "needs_input",
                       "Checked product facts and constraints", critical=len(v["critical"]), optional=len(v["optional"]))
    return {**upd, "intake": v, "product_version_id": (ctx["product"] or {}).get("id", ""),
            "constraint_version_id": (ctx["constraints"] or {}).get("id", ""),
            "audience_version_ids": [a["id"] for a in ctx["audiences"]]}


async def await_intake(state: LaunchState, config) -> dict:
    decision = interrupt({"type": "intake", "title": "Some critical product or launch facts are missing",
                          "critical": state["intake"]["critical"], "optional": state["intake"]["optional"],
                          "resume_with": {"action": "retry"}})
    return {"pending_decision": None, "stage_statuses": {"await_intake": f"resumed:{decision.get('action', 'retry')}"}}


async def research_planner(state: LaunchState, config) -> dict:
    ctx = await ctxsvc.load(uuid.UUID(state["project_id"]))
    areas = await research.ensure_areas(uuid.UUID(state["project_id"]), ctx["constraints"])
    plan = {"areas": len(areas), "tasks": [f"places+climate:{a['name']}" for a in areas] +
            ([f"taste:{a['name']}" for a in areas] if state.get("qloo_enabled", True) else []),
            "qloo": "enabled" if state.get("qloo_enabled", True) and qloo.configured() else
                    ("disabled_by_experiment" if not state.get("qloo_enabled", True) else "unavailable_no_key"),
            "max_research_calls": settings.MAX_RESEARCH_CALLS,
            "gaps_disclosed": [o["question"] for o in state["intake"]["optional"]]}
    upd = await _stage(state, config, "research_planner", "completed", f"Planned research for {len(areas)} locations",
                       areas=len(areas))
    await research.set_run(uuid.UUID(state["run_id"]), counts={"areas": len(areas)})
    return {**upd, "areas": areas, "plan": plan}


async def entity_resolver(state: LaunchState, config) -> dict:
    if not state.get("qloo_enabled", True):
        return {**await _stage(state, config, "entity_resolver", "skipped", "Qloo disabled for this comparison run"),
                "entity_status": {"status": "disabled"}}
    ctx = await ctxsvc.load(uuid.UUID(state["project_id"]))
    budget = qloo.CallBudget()
    res = await research.resolve_entities(uuid.UUID(state["project_id"]), ctx["audiences"], budget)
    status = {"ok": "completed", "needs_decision": "needs_input", "unavailable": "unavailable"}[res["status"]]
    upd = await _stage(state, config, "entity_resolver", status,
                       res.get("message") or f"Resolved audience interests ({len(res['ambiguous'])} need a choice)",
                       calls=budget.used, cache_hits=budget.cache_hits)
    return {**upd, "entity_status": res}


async def await_entities(state: LaunchState, config) -> dict:
    decision = interrupt({"type": "entity_resolution", "title": "Choose the right Qloo entity (or an explicit proxy)",
                          "items": state["entity_status"]["ambiguous"],
                          "note": "Resolve each interest in Audience insights, then continue. A missing entity is never "
                                  "replaced silently.", "resume_with": {"action": "continue"}})
    return {"stage_statuses": {"await_entities": f"resumed:{decision.get('action', 'continue')}"}}


async def geographic_researcher(state: LaunchState, config) -> dict:
    await _stage(state, config, "geographic_researcher", "running", "Gathering places and climate evidence")
    ctx = await ctxsvc.load(uuid.UUID(state["project_id"]))
    run_id, pid = uuid.UUID(state["run_id"]), uuid.UUID(state["project_id"])
    areas = [a for a in state["areas"] if not a.get("error")]
    results = await research.run_parallel(areas, lambda a: research.geographic_research(run_id, pid, a, ctx["product"]),
                                          settings.MAX_PROVIDER_CONCURRENCY)
    geo, errors = {}, []
    for a, r in zip(areas, results, strict=True):
        if isinstance(r, Exception):
            errors.append({"stage": "geographic_researcher", "area": a["name"], "message": str(r)[:300]})
        else:
            geo[a["area_id"]] = r
    await research.set_run(run_id, counts={"places": sum(g.get("places", 0) for g in geo.values() if isinstance(g, dict))})
    upd = await _stage(state, config, "geographic_researcher", "completed" if not errors else "partial",
                       f"Researched {len(geo)} of {len(areas)} locations", errors=len(errors))
    return {**upd, "geo": geo, "errors": errors}


async def taste_analyst(state: LaunchState, config) -> dict:
    ctx = await ctxsvc.load(uuid.UUID(state["project_id"]))
    run_id, pid = uuid.UUID(state["run_id"]), uuid.UUID(state["project_id"])
    budget = qloo.CallBudget()
    areas = [a for a in state["areas"] if not a.get("error")]
    results = await research.run_parallel(
        areas, lambda a: research.taste_analysis(run_id, pid, a, ctx["audiences"], budget, state.get("qloo_enabled", True)),
        min(2, settings.MAX_PROVIDER_CONCURRENCY))
    taste, errors = {}, []
    for a, r in zip(areas, results, strict=True):
        if isinstance(r, Exception):
            errors.append({"stage": "taste_analyst", "area": a["name"], "message": str(r)[:300]})
        else:
            taste[a["area_id"]] = r
    states = {t.get("state") for t in taste.values()}
    status = "completed" if states == {"available"} else ("skipped" if states <= {"disabled_by_experiment"} else "partial")
    upd = await _stage(state, config, "taste_analyst", status, "Taste signals " + ", ".join(sorted(s for s in states if s)),
                       qloo_calls=budget.used, cache_hits=budget.cache_hits)
    return {**upd, "taste": taste, "errors": errors}


async def market_evaluator(state: LaunchState, config) -> dict:
    ctx = await ctxsvc.load(uuid.UUID(state["project_id"]))
    results = await research.evaluate(uuid.UUID(state["run_id"]), uuid.UUID(state["project_id"]), state["areas"],
                                      ctx["constraints"], state.get("taste") or {}, state.get("qloo_enabled", True))
    summary = [{"area_id": r["area_id"], "name": r["name"], "eligible": r["eligible"], "status": r["status"],
                "planning_index": r["planning_index"], "available_weight": r["available_weight"], "rank": r["rank"],
                "practical_rank": r.get("practical_rank")} for r in results]
    upd = await _stage(state, config, "market_evaluator", "completed",
                       f"{sum(r['eligible'] for r in results)} eligible of {len(results)}; "
                       f"{sum(r['status'] == 'complete' for r in results)} fully evidenced")
    return {**upd, "assessments": summary}


async def placement_researcher(state: LaunchState, config) -> dict:
    ctx = await ctxsvc.load(uuid.UUID(state["project_id"]))
    run_id, pid = uuid.UUID(state["run_id"]), uuid.UUID(state["project_id"])
    eligible = {a["area_id"] for a in state["assessments"] if a["eligible"]}
    n = 0
    for a in state["areas"]:
        if a.get("area_id") in eligible:
            n += await research.placement_research(run_id, pid, a, ctx["audiences"], state.get("taste") or {})
    await research.set_run(run_id, counts={"placements": n})
    upd = await _stage(state, config, "placement_researcher", "completed", f"Qualified {n} placement candidates (all unverified)")
    return {**upd, "placements": {"count": n}}


async def await_selection(state: LaunchState, config) -> dict:
    ctx = await ctxsvc.load(uuid.UUID(state["project_id"]))
    eligible = [a for a in state["assessments"] if a["eligible"]]
    async with session_scope() as s:
        run = await s.get(ResearchRun, uuid.UUID(state["run_id"]))
        prev = (run.input_snapshot or {}).get("previous_selections") or []
    options = [{"area_id": a["area_id"], "area_name": a["name"], "status": a["status"], "rank": a["rank"],
                "audience_version_id": au["id"], "audience_name": au["name"], "audience_role": au["role"]}
               for a in eligible for au in ctx["audiences"]]
    decision = interrupt({"type": "select_targets", "title": "Choose location × audience pairs for strategies",
                          "options": options, "suggested": prev or options[:2],
                          "resume_with": {"selections": [{"area_id": "...", "audience_version_id": "..."}]}})
    sel = [x for x in (decision.get("selections") or []) if any(
        o["area_id"] == x.get("area_id") and o["audience_version_id"] == x.get("audience_version_id") for o in options)]
    await research.set_run(uuid.UUID(state["run_id"]), selections={"targets": sel})
    return {"selections": sel, "stage_statuses": {"await_selection": f"{len(sel)} selected"}}


async def strategy_writer(state: LaunchState, config) -> dict:
    await _stage(state, config, "strategy_writer", "running", "Writing evidence-linked strategies")
    ctx = await ctxsvc.load(uuid.UUID(state["project_id"]))
    ids, errors = [], []
    for sel in state.get("selections") or []:
        aud = next((a for a in ctx["audiences"] if a["id"] == sel["audience_version_id"]), None)
        if aud is None:
            errors.append({"stage": "strategy_writer", "message": "audience version no longer current"})
            continue
        jc = _ctx(config)
        if jc:
            await jc.beat()
        r = await strategy.write(ctx, uuid.UUID(state["run_id"]), uuid.UUID(sel["area_id"]), aud,
                                 workspace_id=uuid.UUID(state["tenant_id"]))
        if r.get("strategy_version_id"):
            ids.append(r["strategy_version_id"])
            await events.emit(uuid.UUID(state["tenant_id"]), "run.strategy", f"Strategy {r['status']} for {aud['name']}",
                              project_id=uuid.UUID(state["project_id"]), run_id=uuid.UUID(state["run_id"]),
                              stage="strategy_writer", data=r)
        else:
            errors.append({"stage": "strategy_writer", "message": r.get("reason", r.get("status"))})
    upd = await _stage(state, config, "strategy_writer", "completed" if ids else "failed", f"{len(ids)} strategies ready")
    return {**upd, "strategy_ids": ids, "errors": errors}


async def creative_planner(state: LaunchState, config) -> dict:
    """Default creative set: one brief per strategy in each audience's first
    language, plus a second feature-emphasis angle for end users."""
    ctx = await ctxsvc.load(uuid.UUID(state["project_id"]))
    req = state.get("creative_request") or {}
    ids, errors = list(state.get("brief_ids") or []), []
    if not ids:
        for sid in state.get("strategy_ids") or []:
            from ..models import StrategyVersion
            async with session_scope() as s:
                sv = await s.get(StrategyVersion, uuid.UUID(sid))
            aud = next((a for a in ctx["audiences"] if a["id"] == str(sv.audience_version_id)), None)
            langs = req.get("languages") or [(aud or {}).get("languages", ["en"])[0] if aud and aud.get("languages") else "en"]
            angles = [None]
            if aud and aud["role"] in ("product_user", "purchaser") and req.get("both_feature_hypotheses", True):
                main = sv.content.get("main_feature_key")
                angles = [creative.default_angle(aud["role"], main),
                          "speech_presence" if main != "speech_amplification" else "fan_comfort"]
                enabled = {f["key"] for f in ctx["product"]["features"] if f["enabled"]}
                angles = [a for a in angles if not ((a == "speech_presence" and "speech_amplification" not in enabled)
                                                    or (a == "fan_comfort" and "fan" not in enabled))] or [None]
            for lang in langs:
                for angle in angles:
                    jc = _ctx(config)
                    if jc:
                        await jc.beat()
                    r = await creative.create_brief(ctx, uuid.UUID(sid), language=lang, angle=angle,
                                                    workspace_id=uuid.UUID(state["tenant_id"]))
                    if r.get("brief_id"):
                        ids.append(r["brief_id"])
                    else:
                        errors.append({"stage": "creative_planner", "message": r.get("message", r.get("status"))})
    upd = await _stage(state, config, "creative_planner", "completed" if ids else "failed", f"{len(ids)} creative briefs drafted")
    return {**upd, "brief_ids": ids, "errors": errors}


async def await_creative(state: LaunchState, config) -> dict:
    from ..services.costs import estimate
    n = len(state.get("brief_ids") or [])
    img, _ = estimate("xai", settings.XAI_IMAGE_MODEL, "image", 1)
    vid, src = estimate("xai", settings.XAI_VIDEO_MODEL, "second", 1)
    decision = interrupt({
        "type": "creative_scope", "title": "Review briefs, then choose what to generate and a spending cap",
        "brief_ids": state.get("brief_ids") or [],
        "estimates": {"image_usd_each": str(img) if img is not None else "unknown",
                      "video_usd_per_second": str(vid) if vid is not None else "unknown", "pricing_source": src,
                      "note": "Estimates come from the versioned pricing file; actual cost is recorded from xAI usage."},
        "defaults": {"presets": ["square", "portrait", "vertical"], "video_brief_ids": (state.get("brief_ids") or [])[:1],
                     "orientations": ["vertical", "landscape"], "mode": "full", "cap_usd": 3.0, "narration": False},
        "resume_with": {"approve": True, "presets": ["square"], "video_brief_ids": [], "orientations": ["vertical"],
                        "mode": "full|animatic|none", "cap_usd": 2.0, "narration": False},
        "briefs": n})
    if not decision.get("approve"):
        return {"creative_request": {"approve": False}, "done": True,
                "stage_statuses": {"await_creative": "stopped by user"}}
    from decimal import Decimal

    from ..models import Job
    cap = Decimal(str(decision.get("cap_usd") or 0))
    jc = _ctx(config)
    if jc:
        async with session_scope() as s:
            job = await s.get(Job, jc.job.id)
            job.cost_cap_usd = cap
        jc.job.cost_cap_usd = cap
    return {"creative_request": {**decision, "cap_usd": float(cap)}, "stage_statuses": {"await_creative": "approved"}}


async def image_producer(state: LaunchState, config) -> dict:
    req = state.get("creative_request") or {}
    if not req.get("approve") or not req.get("presets"):
        return await _stage(state, config, "image_producer", "skipped", "No image generation requested")
    await _stage(state, config, "image_producer", "running", "Generating backgrounds and composing flyers")
    jc = _ctx(config)
    results, errors = {}, []
    for bid in state.get("brief_ids") or []:
        if req.get("image_brief_ids") and bid not in req["image_brief_ids"]:
            continue
        try:
            results[bid] = await production.produce_images(jc, uuid.UUID(bid), req["presets"])
        except Exception as e:  # noqa: BLE001 - keep sibling briefs going
            if e.__class__.__name__ == "Cancelled":
                raise
            errors.append({"stage": "image_producer", "brief_id": bid, "message": getattr(e, "message", str(e))[:300]})
            if getattr(e, "status", None) == 402 or getattr(e, "code", "").endswith("cap_reached"):
                break
    made = sum(len(r["created"]) for r in results.values())
    failed = sum(len(r["failed"]) for r in results.values()) + len(errors)
    upd = await _stage(state, config, "image_producer", "completed" if not failed else ("partial" if made else "failed"),
                       f"{made} flyers composed, {failed} failed")
    return {**upd, "image_results": results, "errors": errors}


async def video_producer(state: LaunchState, config) -> dict:
    req = state.get("creative_request") or {}
    if not req.get("approve") or req.get("mode", "none") == "none" or not req.get("video_brief_ids"):
        return await _stage(state, config, "video_producer", "skipped", "No video generation requested")
    await _stage(state, config, "video_producer", "running", "Submitting xAI video jobs")
    jc = _ctx(config)
    results, errors, rids = {}, [], []
    for bid in req["video_brief_ids"]:
        try:
            r = await production.produce_video(jc, uuid.UUID(bid), orientations=req.get("orientations") or ["vertical"],
                                               mode=req.get("mode", "full"), narration=bool(req.get("narration")))
            results[bid] = r
            rids += [c.get("remote_request_id") for c in r.get("clips", []) if c.get("remote_request_id")]
        except Exception as e:  # noqa: BLE001
            if e.__class__.__name__ == "Cancelled":
                raise
            errors.append({"stage": "video_producer", "brief_id": bid, "message": getattr(e, "message", str(e))[:300]})
    ok = [r for r in results.values() if r.get("finals")]
    upd = await _stage(state, config, "video_producer", "completed" if ok and not errors else ("partial" if ok else "failed"),
                       f"{sum(len(r.get('finals', [])) for r in results.values())} final videos")
    return {**upd, "video_results": results, "errors": errors, "remote_request_ids": rids}


async def quality_reviewer(state: LaunchState, config) -> dict:
    jc = _ctx(config)
    out = {}
    for bid in state.get("brief_ids") or []:
        out[bid] = await production.quality_review(jc, uuid.UUID(bid))
    flagged = sum(1 for r in out.values() for x in r["reviewed"] if x.get("passed") is False)
    upd = await _stage(state, config, "quality_reviewer", "completed",
                       f"Reviewed generated imagery; {flagged} item(s) flagged. Nothing is auto-approved.")
    return {**upd, "review": {"flagged": flagged}}


async def exporter_node(state: LaunchState, config) -> dict:
    req = state.get("creative_request") or {}
    if not req.get("approve"):
        return await _stage(state, config, "exporter", "skipped")
    pid, ws = uuid.UUID(state["project_id"]), uuid.UUID(state["tenant_id"])
    async with session_scope() as s:
        ex = Export(project_id=pid, status="running", job_id=_ctx(config).job.id if _ctx(config) else None)
        s.add(ex)
        await s.flush()
        ex_id = ex.id
    r = await exporter.build(pid, ws, ex_id)
    upd = await _stage(state, config, "exporter", "completed", f"Campaign package ready ({r['files']} files)", export_id=str(ex_id))
    return {**upd, "export_id": str(ex_id), "done": True}


# ---------------------------------------------------------------- routing ----
def after_intake(state: LaunchState) -> str:
    return "research_planner" if state["intake"]["ok"] else "await_intake"


def after_entities(state: LaunchState) -> str:
    return "await_entities" if (state.get("entity_status") or {}).get("status") == "needs_decision" else "geographic_researcher"


def after_selection(state: LaunchState) -> str:
    return "strategy_writer" if state.get("selections") else END


def after_creative(state: LaunchState) -> str:
    return "image_producer" if (state.get("creative_request") or {}).get("approve") else END


def build(checkpointer=None):
    g = StateGraph(LaunchState)
    for name, fn in (("intake_validator", intake_validator), ("await_intake", await_intake),
                     ("research_planner", research_planner), ("entity_resolver", entity_resolver),
                     ("await_entities", await_entities), ("geographic_researcher", geographic_researcher),
                     ("taste_analyst", taste_analyst), ("market_evaluator", market_evaluator),
                     ("placement_researcher", placement_researcher), ("await_selection", await_selection),
                     ("strategy_writer", strategy_writer), ("creative_planner", creative_planner),
                     ("await_creative", await_creative), ("image_producer", image_producer),
                     ("video_producer", video_producer), ("quality_reviewer", quality_reviewer),
                     ("exporter", exporter_node)):
        g.add_node(name, fn)
    g.add_edge(START, "intake_validator")
    g.add_conditional_edges("intake_validator", after_intake, ["research_planner", "await_intake"])
    g.add_edge("await_intake", "intake_validator")
    g.add_edge("research_planner", "entity_resolver")
    g.add_conditional_edges("entity_resolver", after_entities, ["await_entities", "geographic_researcher"])
    g.add_edge("await_entities", "entity_resolver")
    g.add_edge("geographic_researcher", "taste_analyst")
    g.add_edge("taste_analyst", "market_evaluator")
    g.add_edge("market_evaluator", "placement_researcher")
    g.add_edge("placement_researcher", "await_selection")
    g.add_conditional_edges("await_selection", after_selection, ["strategy_writer", END])
    g.add_edge("strategy_writer", "creative_planner")
    g.add_edge("creative_planner", "await_creative")
    g.add_conditional_edges("await_creative", after_creative, ["image_producer", END])
    g.add_edge("image_producer", "video_producer")
    g.add_edge("video_producer", "quality_reviewer")
    g.add_edge("quality_reviewer", "exporter")
    g.add_edge("exporter", END)
    return g.compile(checkpointer=checkpointer)


async def assessments_for_run(run_id: uuid.UUID) -> list[LocationAssessment]:
    async with session_scope() as s:
        return list((await s.execute(select(LocationAssessment).where(LocationAssessment.run_id == run_id))).scalars().all())


_ = Any
