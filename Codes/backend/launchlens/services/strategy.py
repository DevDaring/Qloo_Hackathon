"""Strategy writer. The model drafts positioning and plans in a fixed schema
from evidence it is given; the backend then validates every evidence id and
placement id, strips unsupported claims, and computes the budget scenario
itself. No numeric input is taken from the model."""
from __future__ import annotations

import logging
import uuid

from pydantic import BaseModel, Field
from sqlalchemy import func, select

from ..db import session_scope
from ..models import (
    EvidenceRecord, GeographicArea, LocationAssessment, PlacementCandidate, ResearchRun, StrategyVersion,
)
from ..providers import llm
from ..providers.base import ProviderError
from . import claims as claimcheck
from . import costs, hashing, scoring

log = logging.getLogger("launchlens.strategy")


class Ref(BaseModel):
    text: str
    evidence_ids: list[str] = Field(default_factory=list)


class PlacementPick(BaseModel):
    placement_id: str
    rationale: str
    verification_questions: list[str] = Field(default_factory=list)


class Step(BaseModel):
    step: str
    timing: str = ""


class Kpi(BaseModel):
    metric: str
    target_to_test: str
    rationale: str = ""


class Pilot(BaseModel):
    duration_weeks: int = Field(ge=1, le=12)
    objective: str
    steps: list[str]
    success_signals: list[str]


class StrategyDraft(BaseModel):
    positioning: str
    main_feature_key: str
    main_feature_rationale: Ref
    supporting_benefits: list[Ref]
    key_messages: list[Ref]
    partner_shortlist: list[PlacementPick]
    placement_options: list[PlacementPick]
    launch_steps: list[Step]
    pilot_plan: Pilot
    kpis_to_test: list[Kpi]
    expected_learning: list[str]
    assumptions: list[str]
    limitations: list[str]
    feature_hypotheses: list[Ref] = Field(default_factory=list, description="Two competing feature-emphasis hypotheses")


class _Positioning(BaseModel):
    positioning: str = Field(max_length=300)


async def _rewrite_positioning(text: str, issues: list[dict], product: dict, audience: dict, area: str,
                               main_key: str, kw: dict, usage) -> str:
    """One targeted rewrite when the claim check rejects the positioning; if that
    also fails, a plain factual line built only from owner-stated product facts."""
    feat = next((f for f in product["features"] if f["key"] == main_key), product["features"][0])
    try:
        r, _m = await llm.structured(
            _Positioning, "Rewrite one marketing positioning statement so it makes no unsupported claim.",
            f"<data>\nSTATEMENT: {text}\nPROBLEMS: {[(i['term'], i['reason']) for i in issues]}\n"
            f"PRODUCT: {product['name']}. Main feature: {feat['name']} — {feat['proposed_benefit']}.\n"
            f"AUDIENCE: {audience['name']}. LOCATION: {area}.\nAPPROVED CLAIMS: {kw.get('approved_claims')}\n</data>\n"
            "Keep it one sentence, plain and specific. Avoid quality adjectives (durable, reliable, premium, best, "
            "powerful), numbers, guarantees and any claim not in the approved claims.",
            usage=usage, max_tokens=200, temperature=0.2)
        if not claimcheck.check(r.positioning, **kw):
            return r.positioning
    except ProviderError:
        pass
    return f"{product['name']} for {audience['name'].split(' (')[0].lower()} in {area}: {feat['name'].lower()} — {feat['proposed_benefit'].rstrip('.').lower()}."


async def gather(project_id: uuid.UUID, run_id: uuid.UUID, area_id: uuid.UUID, audience_version_id: uuid.UUID) -> dict:
    async with session_scope() as s:
        la = (await s.execute(select(LocationAssessment).where(LocationAssessment.run_id == run_id,
                                                               LocationAssessment.area_id == area_id))).scalar_one()
        area = await s.get(GeographicArea, area_id)
        evs = (await s.execute(select(EvidenceRecord).where(
            EvidenceRecord.run_id == run_id, EvidenceRecord.area_id == area_id,
            (EvidenceRecord.audience_version_id.is_(None)) | (EvidenceRecord.audience_version_id == audience_version_id)))).scalars().all()
        pcs = (await s.execute(select(PlacementCandidate).where(
            PlacementCandidate.run_id == run_id, PlacementCandidate.area_id == area_id,
            PlacementCandidate.audience_version_id == audience_version_id).order_by(PlacementCandidate.suitability_score.desc()))).scalars().all()
    return {"assessment": la, "area": area, "evidence": evs, "placements": pcs}


def _evidence_lines(evs) -> str:
    """Evidence is cited by short aliases (E1, E2, ...) that models copy
    reliably; aliases are mapped back to UUIDs before anything is stored."""
    out = []
    for i, e in enumerate(evs, 1):
        out.append(f'- E{i} [{e.kind}] {e.title}: {e.statement} (source: {e.source}; limits: {e.limitations[:160]})')
    return "\n".join(out)


def _alias_map(evs) -> dict[str, str]:
    m = {f"E{i}": str(e.id) for i, e in enumerate(evs, 1)}
    m.update({str(e.id): str(e.id) for e in evs})
    return m


def _template(ctx: dict, g: dict, audience: dict) -> StrategyDraft:
    """Deterministic fallback when no reasoning provider is available."""
    feats = [f for f in ctx["product"]["features"] if f["enabled"]]
    hyp = next((e for e in g["evidence"] if e.topic == "feature_relevance"), None)
    hyp_key = ((hyp.scope or {}).get("feature_key") or "fan") if hyp else None
    main = next((f for f in feats if f["key"] == hyp_key), feats[0]) if hyp else feats[0]
    pcs = [p for p in g["placements"] if p.channel_type != "digital_geo"][:4]
    digital = [p for p in g["placements"] if p.channel_type == "digital_geo"][:1]
    eid = [str(hyp.id)] if hyp else []
    return StrategyDraft(
        positioning=f"{ctx['product']['name']} for {audience['name']} in {g['area'].name}: practical comfort and everyday independence, shown in person.",
        main_feature_key=main["key"], main_feature_rationale=Ref(text=f"Lead with {main['name']} (hypothesis to test).", evidence_ids=eid),
        supporting_benefits=[Ref(text=f["proposed_benefit"] or f["name"]) for f in feats if f["key"] != main["key"]][:3],
        key_messages=[Ref(text=f"{main['name']}: {main['proposed_benefit']}", evidence_ids=eid)],
        partner_shortlist=[PlacementPick(placement_id=str(p.id), rationale=p.relationship_note) for p in pcs[:3]],
        placement_options=[PlacementPick(placement_id=str(p.id), rationale=p.relationship_note,
                                         verification_questions=["Are demonstrations or flyers permitted?", "What does it cost?", "Who decides?"])
                           for p in pcs + digital],
        launch_steps=[Step(step="Verify two partner venues and one demo date", timing="Week 1"),
                      Step(step="Run in-person demonstrations with flyers", timing="Weeks 2–3"),
                      Step(step="Run a small geo-targeted digital test", timing="Weeks 2–4")],
        pilot_plan=Pilot(duration_weeks=4, objective="Learn which message and venue type produce inquiries",
                         steps=["Two demo sessions", "Counter flyers at verified partners", "Small digital test"],
                         success_signals=["Inquiries per demo session", "Click-through on digital test"]),
        kpis_to_test=[Kpi(metric="Inquiries per demo session", target_to_test="Set after first session"),
                      Kpi(metric="Digital click-through rate", target_to_test="Compare message variants")],
        expected_learning=["Which feature message resonates", "Which venue type converts to inquiries"],
        assumptions=["Venue permissions and costs are unknown until verified."],
        limitations=["Template strategy: the reasoning provider was unavailable."],
        feature_hypotheses=[Ref(text=f"H{i + 1}: lead with {f['name']}") for i, f in enumerate(feats[:2])])


async def write(ctx: dict, run_id: uuid.UUID, area_id: uuid.UUID, audience: dict, *, workspace_id: uuid.UUID,
                force: bool = False) -> dict:
    """Create (or reuse, when inputs are unchanged) a strategy version."""
    project_id = uuid.UUID(ctx["project"]["id"])
    av_id = uuid.UUID(audience["id"])
    g = await gather(project_id, run_id, area_id, av_id)
    la = g["assessment"]
    if not la.eligible:
        return {"status": "excluded", "reason": "; ".join(h["reason"] for h in la.hard_constraints if h["result"] == "fail")}
    ihash = hashing.strategy_hash(ctx["product"]["hash"], audience["hash"], la.input_hash,
                                  [p.name for p in g["placements"]])
    async with session_scope() as s:
        prior = (await s.execute(select(StrategyVersion).where(
            StrategyVersion.project_id == project_id, StrategyVersion.area_id == area_id,
            StrategyVersion.audience_version_id == av_id).order_by(StrategyVersion.version.desc()).limit(1))).scalar_one_or_none()
    if prior and prior.input_hash == ihash and not prior.stale and not force:
        return {"status": "reused", "strategy_version_id": str(prior.id), "version": prior.version}

    product = ctx["product"]
    approved = [c["text"] for c in ctx["claims"] if c["approved"]]
    feats = [f for f in product["features"] if f["enabled"]]
    disabled = [f["key"] for f in product["features"] if not f["enabled"]]
    placements_txt = "\n".join(
        f"- placement_id={p.id} [{p.channel_type}/{p.category}] {p.name}: {p.relationship_note} status={p.status}"
        for p in g["placements"][:12])
    system = ("Write an evidence-linked launch strategy for one location and one audience. Use only the evidence and "
              "placements listed. Cite evidence ids exactly as given. Mark interpretations as hypotheses. KPIs are "
              "targets to test, never predicted outcomes. Do not state any number that is not in the evidence. "
              "Cite evidence with its alias exactly as listed (E1, E2, ...). "
              "Do not mention disability status inferred from tastes. Choose main_feature_key from the feature keys.")
    user = f"""<data>
PRODUCT: {product['name']} ({product['category']}). {product['description']}
FEATURES (key: name — mechanism — proposed benefit — evidence status):
{chr(10).join(f"- {f['key']}: {f['name']} — {f['mechanism']} — {f['proposed_benefit']} — {f['evidence_status']}" for f in feats)}
APPROVED CLAIMS: {approved or 'none yet'}
AUDIENCE: {audience['name']} — role {audience['role']}. {audience['description']} Needs: {audience['needs']}
LOCATION: {g['area'].name}. Eligibility: {'eligible' if la.eligible else 'excluded'}; status {la.status}; planning index {la.planning_index} with {float(la.available_weight):.0%} of weight available.
EVIDENCE:
{_evidence_lines(g['evidence'])}
PLACEMENTS:
{placements_txt}
</data>
Return the strategy JSON. Provide exactly two feature_hypotheses (competing feature-emphasis hypotheses)."""
    usage = llm.Usage("openai", "")
    generator: dict
    try:
        draft, model = await llm.structured(StrategyDraft, system, user, usage=usage, max_tokens=3500)
        generator = {"type": "llm", "model": model, "usage": usage.log}
        await costs.record(workspace_id=workspace_id, project_id=project_id, provider=usage.provider, model=usage.model,
                           operation="strategy", category="reasoning", quantity=usage.input_tokens / 1000,
                           unit="1k_input_tokens", actual_usd=llm.cost_of(usage), run_id=run_id)
    except ProviderError as e:
        log.warning("strategy model unavailable, using template: %s", e.message)
        draft = _template(ctx, g, audience)
        generator = {"type": "template", "reason": e.message}

    # ---- deterministic validation ----
    valid_pids = {str(p.id) for p in g["placements"]}
    ev_ids = {str(e.id) for e in g["evidence"]}
    dropped = {"evidence_ids": [], "placements": [], "claims": []}

    aliases = _alias_map(g["evidence"])

    def clean_ref(r: Ref) -> Ref:
        mapped = [aliases.get(i.strip().upper() if i.strip().upper().startswith("E") and len(i.strip()) < 6 else i.strip()) for i in r.evidence_ids]
        keep = list(dict.fromkeys(i for i in mapped if i in ev_ids))
        dropped["evidence_ids"] += [i for i, mm in zip(r.evidence_ids, mapped, strict=True) if mm not in ev_ids]
        return Ref(text=r.text, evidence_ids=keep)

    d = draft.model_dump()
    draft = StrategyDraft(**d)
    draft.main_feature_rationale = clean_ref(draft.main_feature_rationale)
    draft.supporting_benefits = [clean_ref(r) for r in draft.supporting_benefits]
    draft.key_messages = [clean_ref(r) for r in draft.key_messages]
    draft.feature_hypotheses = [clean_ref(r) for r in draft.feature_hypotheses]
    for lst in ("partner_shortlist", "placement_options"):
        kept = [p for p in getattr(draft, lst) if p.placement_id in valid_pids]
        dropped["placements"] += [p.placement_id for p in getattr(draft, lst) if p.placement_id not in valid_pids]
        setattr(draft, lst, kept)
    if draft.main_feature_key not in {f["key"] for f in feats}:
        draft.main_feature_key = feats[0]["key"]
    prohibited = [x for f in feats for x in (f.get("prohibited_exaggerations") or [])]
    kw = dict(approved_claims=approved, enabled_features=[f["key"] for f in feats], disabled_features=disabled,
              prohibited=prohibited)
    clean_msgs = []
    for r in draft.key_messages + draft.supporting_benefits:
        issues = claimcheck.check(r.text, **kw)
        if issues:
            dropped["claims"].append({"text": r.text, "issues": issues})
        else:
            clean_msgs.append(r)
    draft.key_messages = [r for r in draft.key_messages if r in clean_msgs]
    draft.supporting_benefits = [r for r in draft.supporting_benefits if r in clean_msgs]
    pos_issues = claimcheck.check(draft.positioning, **kw)
    if pos_issues:
        dropped["claims"].append({"text": draft.positioning, "issues": pos_issues})
        draft.positioning = await _rewrite_positioning(draft.positioning, pos_issues, product, audience, g["area"].name,
                                                       draft.main_feature_key, kw, usage)

    chosen = [p for p in g["placements"] if str(p.id) in {x.placement_id for x in draft.placement_options}]
    async with session_scope() as s:
        run = await s.get(ResearchRun, run_id)
        cons = run.input_snapshot.get("constraints") or {}
    budget = scoring.budget_scenario(cons.get("ad_spend_budget"), cons.get("currency", "INR"),
                                     [{"name": p.name, "channel_type": p.channel_type} for p in chosen])
    all_refs = set(draft.main_feature_rationale.evidence_ids)
    for r in draft.supporting_benefits + draft.key_messages + draft.feature_hypotheses:
        all_refs |= set(r.evidence_ids)
    all_refs |= set(la.evidence_ids or [])
    content = draft.model_dump()
    content["selected"] = {"area_id": str(area_id), "area_name": g["area"].name, "audience_version_id": audience["id"],
                           "audience_name": audience["name"], "audience_role": audience["role"]}
    content["location_summary"] = {"status": la.status, "planning_index": float(la.planning_index) if la.planning_index is not None else None,
                                   "available_weight": float(la.available_weight), "rank": la.rank}
    async with session_scope() as s:
        n = (await s.execute(select(func.coalesce(func.max(StrategyVersion.version), 0)).where(
            StrategyVersion.project_id == project_id, StrategyVersion.area_id == area_id,
            StrategyVersion.audience_version_id == av_id))).scalar_one()
        sv = StrategyVersion(project_id=project_id, run_id=run_id, area_id=area_id, audience_version_id=av_id,
                             product_version_id=uuid.UUID(product["id"]), version=n + 1, content=content,
                             budget_scenario=budget, evidence_ids=sorted(all_refs), generator=generator,
                             validation={"dropped": dropped, "claim_checker": "deterministic v1"}, input_hash=ihash)
        s.add(sv)
        await s.flush()
        return {"status": "created", "strategy_version_id": str(sv.id), "version": sv.version, "generator": generator["type"]}
