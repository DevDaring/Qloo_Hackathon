"""Read-only explanation views built from stored records only (no provider
calls): the taste-to-campaign story, audience comparison, creative trace,
opportunities, revision previews and the project journey.

Every relationship returned here is backed by a stored record. Each edge says
what kind of relationship it is:

  qloo_explainability  Qloo attributed this recommendation to this input signal
  qloo_combined_set    Qloo recommended it for the whole interest set (no per-input attribution)
  app_derived          LaunchLens computed it (formula given), from evidence ids given
  generated_hypothesis A language model proposed it; it is a hypothesis, not a Qloo fact
"""
from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import (
    Asset, Audience, AudienceVersion, CampaignResult, Claim, CreativeBrief, EvidenceRecord, Export,
    GeographicArea, LocationAssessment, Place, PlacementCandidate, ProductAsset, ProductVersion, ResearchRun,
    ResolvedEntity, StrategyVersion,
)
from . import context as ctxsvc
from . import evidence as evsvc

SUITABILITY_FORMULA = "0.45 × category fit + 0.25 × proximity + 0.30 × Qloo affinity rank among this audience's candidates"
QLOO_KINDS = ("provider_signal",)
GENERATED_NOTE = "Generated campaign hypothesis — proposed by a language model from the cited evidence; not a Qloo fact or a result."


def _f(v):
    return float(v) if v is not None else None


def _iso(v):
    return v.isoformat() if v is not None else None


async def _snapshot(s: AsyncSession, run: ResearchRun) -> dict:
    """The run's frozen inputs; runs recorded before entities were frozen fall
    back to the stored decisions for the run's audience versions."""
    snap = dict(run.input_snapshot or {})
    if "entities" not in snap:
        ids = []
        for a in snap.get("audiences") or []:
            try:
                ids.append(uuid.UUID(a["id"]))
            except (KeyError, ValueError):
                continue
        rows = (await s.execute(select(ResolvedEntity).where(ResolvedEntity.audience_version_id.in_(ids)))).scalars().all() if ids else []
        snap["entities"] = [{"id": str(e.id), "audience_version_id": str(e.audience_version_id), "query_text": e.query_text,
                             "status": e.status, "qloo_id": e.qloo_id, "qloo_type": e.qloo_type,
                             "canonical_name": e.canonical_name, "proxy_for": e.proxy_for} for e in rows]
    return snap


def _interests(snapshot: dict, audience_version_id: str) -> list[dict]:
    rows = [e for e in snapshot.get("entities") or [] if e.get("audience_version_id") == audience_version_id]
    out = []
    for e in rows:
        out.append({"id": e.get("qloo_id"), "entity_row_id": e.get("id"), "label": e.get("canonical_name") or e.get("query_text"),
                    "query_text": e.get("query_text"), "status": e.get("status"), "type": e.get("qloo_type"),
                    "is_tag": (e.get("qloo_type") or "").startswith("urn:tag"), "proxy_for": e.get("proxy_for"),
                    "used_as_signal": e.get("status") in ("resolved", "proxy") and bool(e.get("qloo_id"))})
    return out


async def _evidence(s: AsyncSession, project_id: uuid.UUID, ids) -> dict[str, EvidenceRecord]:
    want = []
    for i in ids or []:
        try:
            want.append(uuid.UUID(str(i)))
        except ValueError:
            continue
    if not want:
        return {}
    rows = (await s.execute(select(EvidenceRecord).where(EvidenceRecord.project_id == project_id,
                                                         EvidenceRecord.id.in_(want)))).scalars().all()
    return {str(e.id): e for e in rows}


def _ev_brief(e: EvidenceRecord) -> dict:
    nature = ("qloo_signal" if e.kind in QLOO_KINDS and e.source.lower().startswith("qloo") else
              "derived" if e.kind == "derived_metric" else
              "generated" if e.kind in ("generated", "hypothesis") else
              "data_gap" if e.kind == "data_gap" else "observed")
    return {"id": str(e.id), "kind": e.kind, "nature": nature, "topic": e.topic, "title": e.title, "status": e.status,
            "source": e.source, "retrieved_at": _iso(e.retrieved_at), "badge": evsvc.BADGE.get(e.kind, e.kind)}


async def _taste_evidence(s, run_id, area_id, audience_version_id) -> dict[str, EvidenceRecord]:
    rows = (await s.execute(select(EvidenceRecord).where(
        EvidenceRecord.run_id == run_id, EvidenceRecord.audience_version_id == audience_version_id,
        EvidenceRecord.topic.in_(("taste", "taste_partners", "taste_common")),
        (EvidenceRecord.area_id == area_id) | (EvidenceRecord.area_id.is_(None)))
        .order_by(EvidenceRecord.created_at))).scalars().all()
    return {e.topic: e for e in rows}


def _city_signal(common: EvidenceRecord | None, area_id: str) -> dict:
    if common is None:
        return {"state": "missing", "reason": "No city-level taste comparison was recorded for this audience."}
    row = ((common.payload or {}).get("rows") or {}).get(area_id)
    if not row:
        return {"state": "missing", "evidence_id": str(common.id), "reason": "This area was not part of the comparison."}
    return {"state": row.get("state"), "lift": row.get("lift"), "log2_lift": row.get("log2_lift"),
            "n_signal": row.get("n_signal"), "n_baseline": row.get("n_baseline"), "evidence_id": str(common.id),
            "retrieved_at": _iso(common.retrieved_at), "formula": common.formula,
            "meaning": "How much more often this area appears among places Qloo recommends for these interests than "
                       "among places returned with no interests (same query area, same categories)."}


# ------------------------------------------------------------- Feature A ----
async def taste_story(s: AsyncSession, run: ResearchRun, area_id: uuid.UUID, audience_version_id: uuid.UUID,
                      max_places: int = 5, place_id: uuid.UUID | None = None) -> dict:
    snap = await _snapshot(s, run)
    aud = next((a for a in snap.get("audiences") or [] if a["id"] == str(audience_version_id)), None)
    area = await s.get(GeographicArea, area_id)
    interests = _interests(snap, str(audience_version_id))
    signal_ids = [i["id"] for i in interests if i["used_as_signal"]]
    tev = await _taste_evidence(s, run.id, area_id, audience_version_id)
    partners_ev, taste_ev = tev.get("taste_partners"), tev.get("taste")
    warning = ((taste_ev.scope or {}).get("explainability_warning") if taste_ev else None)
    if warning and not isinstance(warning, str):
        warning = "Qloo could not calculate explainability for these signals (it attributes entity signals only)."
    story = {"run_id": str(run.id), "area": {"id": str(area_id), "name": area.name if area else None},
             "audience": {"id": str(audience_version_id), "name": aud["name"] if aud else None,
                          "role": aud["role"] if aud else None},
             "qloo_enabled": run.qloo_enabled, "interests": interests, "city_signal": _city_signal(tev.get("taste_common"), str(area_id)),
             "recommendations": [], "placement": None, "hypothesis": None, "creative": None, "edges": [],
             "warnings": [w for w in [warning] if w], "attribution": None, "evidence": {}, "unknown_evidence_ids": [],
             "state": None, "message": None, "legend": {
                 "qloo_explainability": "Qloo attributed this recommendation to this input",
                 "qloo_combined_set": "Recommended for this combined interest set (Qloo gave no per-input attribution)",
                 "app_derived": "Computed by LaunchLens from the linked evidence",
                 "generated_hypothesis": "Proposed by a language model — a campaign hypothesis, not a Qloo fact"}}
    if not run.qloo_enabled:
        story["state"] = "qloo_disabled"
        story["message"] = "This run withheld Qloo signals (experiment condition), so there is no taste story."
        return story
    if not signal_ids:
        story["state"] = "no_signals"
        story["message"] = "No approved interests for this audience. Resolve at least one interest to see Qloo recommendations."
        return story

    # Qloo-recommended places of partner categories stored for this run/area.
    places = (await s.execute(select(Place).where(Place.run_id == run.id, Place.area_id == area_id,
                                                  Place.provider == "qloo"))).scalars().all()
    aid = str(audience_version_id)
    ranked = sorted([p for p in places if ((p.metadata_ or {}).get("qloo_affinity_by_audience") or {}).get(aid) is not None],
                    key=lambda p: -p.metadata_["qloo_affinity_by_audience"][aid])
    pcs = (await s.execute(select(PlacementCandidate).where(
        PlacementCandidate.run_id == run.id, PlacementCandidate.area_id == area_id,
        PlacementCandidate.audience_version_id == audience_version_id, PlacementCandidate.place_id.is_not(None))
        .order_by(PlacementCandidate.shortlisted.desc(), PlacementCandidate.suitability_score.desc()))).scalars().all()
    # the placement the story leads to: shortlisted first, else the most suitable one backed by a Qloo place
    qloo_place_ids = {p.id for p in ranked}
    lead = next((pc for pc in pcs if pc.shortlisted and pc.place_id in qloo_place_ids), None) or \
        next((pc for pc in pcs if pc.place_id in qloo_place_ids), None)
    shown = ranked[:max_places]
    if lead and lead.place_id not in {p.id for p in shown}:
        shown = shown[:max_places - 1] + [p for p in ranked if p.id == lead.place_id]
    if place_id is not None:
        focus = next((p for p in ranked if p.id == place_id), None)
        if focus is None:
            story["focus_note"] = "Qloo gave this place no affinity for this audience's interests."
        elif focus not in shown:
            keep = [p for p in shown if lead is None or p.id == lead.place_id][:1]
            shown = [p for p in shown if p not in keep][:max_places - 1 - len(keep)] + keep + [focus]
        story["focus_place_id"] = str(place_id)
    if not shown:
        story["state"] = "no_recommendations"
        story["message"] = ("Qloo returned no partner-type places with affinity for these interests in this area."
                            if partners_ev else "No Qloo place query was recorded for this audience and area.")
        return story

    ev_id = str(partners_ev.id) if partners_ev else None
    query_hash = (partners_ev.scope or {}).get("query_hash") if partners_ev else None
    any_attributed = False
    for rank, p in enumerate(ranked, start=1):
        if p not in shown:
            continue
        expl = ((p.metadata_ or {}).get("qloo_explanation_by_audience") or {}).get(aid) or {"status": "not_provided", "contributions": []}
        contribs = [c for c in expl.get("contributions") or [] if c.get("id") in signal_ids]
        status = "provided" if contribs else (expl.get("status") if expl.get("status") != "provided" else "not_matched")
        node = {"id": str(p.id), "qloo_id": p.qloo_entity_id, "name": p.name, "category": p.category,
                "affinity": p.metadata_["qloo_affinity_by_audience"][aid], "affinity_rank": rank, "of": len(ranked),
                "popularity": (p.metadata_ or {}).get("qloo_popularity"), "distance_m": _f(p.distance_m),
                "retrieved_at": _iso(p.retrieved_at), "accessibility": p.accessibility,
                "explanation": {  # TasteExplanation view model; missing fields stay missing
                    "audience_version_id": aid, "run_id": str(run.id), "signal_ids": signal_ids,
                    "candidate_id": p.qloo_entity_id, "evidence_ids": [ev_id] if ev_id else [],
                    "query_fingerprint": query_hash, "retrieved_at": _iso(partners_ev.retrieved_at) if partners_ev else None,
                    "status": status, "contributions": contribs or None,
                    "warnings": [w for w in [warning] if w and not contribs]}}
        story["recommendations"].append(node)
        if contribs:
            any_attributed = True
            for c in contribs:
                story["edges"].append({"from": f"interest:{c['id']}", "to": f"place:{p.id}", "kind": "qloo_explainability",
                                       "score": c.get("score"), "evidence_ids": node["explanation"]["evidence_ids"]})
        else:
            story["edges"].append({"from": "interest_set", "to": f"place:{p.id}", "kind": "qloo_combined_set",
                                   "label": "recommended for this combined interest set",
                                   "evidence_ids": node["explanation"]["evidence_ids"]})
    story["attribution"] = "per_input" if any_attributed else "combined_set"

    if lead:
        story["placement"] = {"id": str(lead.id), "name": lead.name, "place_id": str(lead.place_id),
                              "category": lead.category, "shortlisted": lead.shortlisted,
                              "suitability": _f(lead.suitability_score), "formula": SUITABILITY_FORMULA,
                              "status": lead.status, "verification": lead.verification, "accessibility": lead.accessibility,
                              "next_action": lead.next_action, "evidence_needed": lead.evidence_needed,
                              "practical_evidence_ids": lead.practical_evidence_ids}
        story["edges"].append({"from": f"place:{lead.place_id}", "to": f"placement:{lead.id}", "kind": "app_derived",
                               "label": SUITABILITY_FORMULA,
                               "evidence_ids": [*(lead.practical_evidence_ids or []), *([ev_id] if ev_id else [])]})

    sv = (await s.execute(select(StrategyVersion).where(
        StrategyVersion.project_id == run.project_id, StrategyVersion.area_id == area_id,
        StrategyVersion.audience_version_id == audience_version_id, StrategyVersion.stale.is_(False))
        .order_by((StrategyVersion.run_id == run.id).desc(), StrategyVersion.version.desc()).limit(1))).scalar_one_or_none()
    if sv:
        c = sv.content or {}
        picks = {x.get("placement_id") for x in (c.get("partner_shortlist") or []) + (c.get("placement_options") or [])}
        msg = (c.get("key_messages") or [{}])[0]
        story["hypothesis"] = {"strategy_id": str(sv.id), "version": sv.version, "generated": True, "note": GENERATED_NOTE,
                               "positioning": c.get("positioning"), "main_feature_key": c.get("main_feature_key"),
                               "message": msg.get("text"), "message_evidence_ids": msg.get("evidence_ids") or [],
                               "pilot_objective": (c.get("pilot_plan") or {}).get("objective"),
                               "generator": (sv.generator or {}).get("type"), "model": (sv.generator or {}).get("model"),
                               "from_this_run": sv.run_id == run.id}
        if lead:
            story["edges"].append({"from": f"placement:{lead.id}", "to": f"strategy:{sv.id}", "kind": "generated_hypothesis",
                                   "label": "strategy cites this placement" if str(lead.id) in picks
                                   else "strategy for the same audience and area", "cites": str(lead.id) in picks,
                                   "evidence_ids": [i for i in msg.get("evidence_ids") or []]})
        briefs = (await s.execute(select(CreativeBrief).where(CreativeBrief.strategy_version_id == sv.id,
                                                              CreativeBrief.is_current.is_(True))
                                  .order_by(CreativeBrief.created_at.desc()))).scalars().all()
        b, flyer = (briefs[0] if briefs else None), None
        for cand in briefs:  # the newest current brief that already has a flyer, else the newest brief
            f = (await s.execute(select(Asset).where(Asset.brief_id == cand.id, Asset.kind == "flyer", Asset.deleted_at.is_(None))
                                 .order_by(Asset.stale.asc(), Asset.created_at.desc()).limit(1))).scalar_one_or_none()
            if f:
                b, flyer = cand, f
                break
        if b:
            d = (b.decisions or [{}])[0]
            story["creative"] = {"brief_id": str(b.id), "language": b.language, "headline": (b.content or {}).get("headline"),
                                 "decision": {"text": d.get("decision"), "rationale": d.get("rationale"),
                                              "kind": d.get("kind"), "evidence_ids": d.get("evidence_ids") or []},
                                 "preview_url": f"/api/v1/assets/{flyer.id}/download" if flyer else None,
                                 "preview_stale": flyer.stale if flyer else None, "generated": True}
            story["edges"].append({"from": f"strategy:{sv.id}", "to": f"brief:{b.id}", "kind": "generated_hypothesis",
                                   "label": "brief written from this strategy", "evidence_ids": d.get("evidence_ids") or []})
    story["state"] = "complete" if story["placement"] and story["hypothesis"] else "partial"
    # every evidence id cited by an edge must belong to this project; unknown ids are reported, never hidden
    cited = {i for e in story["edges"] for i in e.get("evidence_ids") or []}
    known = await _evidence(s, run.project_id, cited)
    story["evidence"] = {k: _ev_brief(v) for k, v in known.items()}
    story["unknown_evidence_ids"] = sorted(cited - set(known))
    return story


# ------------------------------------------------------------- Feature C ----
async def audience_compare(s: AsyncSession, run: ResearchRun, area_id: uuid.UUID, a_id: uuid.UUID, b_id: uuid.UUID) -> dict:
    snap = await _snapshot(s, run)
    auds = {a["id"]: a for a in snap.get("audiences") or []}
    tev_common = None
    side = {}
    for vid in (a_id, b_id):
        tev = await _taste_evidence(s, run.id, area_id, vid)
        tev_common = tev.get("taste_common")
        pcs = (await s.execute(select(PlacementCandidate).where(
            PlacementCandidate.run_id == run.id, PlacementCandidate.area_id == area_id,
            PlacementCandidate.audience_version_id == vid, PlacementCandidate.place_id.is_not(None))
            .order_by(PlacementCandidate.suitability_score.desc()).limit(6))).scalars().all()
        sv = (await s.execute(select(StrategyVersion).where(
            StrategyVersion.area_id == area_id, StrategyVersion.audience_version_id == vid,
            StrategyVersion.stale.is_(False)).order_by(StrategyVersion.version.desc()).limit(1))).scalar_one_or_none()
        a = auds.get(str(vid)) or {}
        side[str(vid)] = {
            "audience": {"id": str(vid), "name": a.get("name"), "role": a.get("role"), "needs": a.get("needs") or [],
                         "languages": a.get("languages") or []},
            "interests": [i for i in _interests(snap, str(vid)) if i["used_as_signal"]],
            "city_signal": _city_signal(tev_common, str(area_id)),
            "shortlist": [{"placement_id": str(p.id), "place_id": str(p.place_id), "name": p.name, "category": p.category,
                           "rank": i + 1, "suitability": _f(p.suitability_score),
                           "affinity": (p.qloo_relevance or {}).get("affinity"), "shortlisted": p.shortlisted}
                          for i, p in enumerate(pcs)],
            "strategy": {"id": str(sv.id), "positioning": sv.content.get("positioning"),
                         "main_feature_key": sv.content.get("main_feature_key"),
                         "message": ((sv.content.get("key_messages") or [{}])[0]).get("text"), "generated": True}
            if sv else None}
    A, B = side[str(a_id)], side[str(b_id)]
    names_a = {x["place_id"]: x for x in A["shortlist"]}
    names_b = {x["place_id"]: x for x in B["shortlist"]}
    diff = {"only_a": [names_a[k]["name"] for k in names_a.keys() - names_b.keys()],
            "only_b": [names_b[k]["name"] for k in names_b.keys() - names_a.keys()],
            "both": [{"name": names_a[k]["name"], "rank_a": names_a[k]["rank"], "rank_b": names_b[k]["rank"]}
                     for k in names_a.keys() & names_b.keys()],
            "interests_only_a": sorted({i["label"] for i in A["interests"]} - {i["label"] for i in B["interests"]}),
            "interests_only_b": sorted({i["label"] for i in B["interests"]} - {i["label"] for i in A["interests"]}),
            "main_feature_changed": bool(A["strategy"] and B["strategy"] and
                                         A["strategy"]["main_feature_key"] != B["strategy"]["main_feature_key"])}
    changed = bool(diff["only_a"] or diff["only_b"] or any(x["rank_a"] != x["rank_b"] for x in diff["both"])
                   or diff["main_feature_changed"])
    area = await s.get(GeographicArea, area_id)
    return {"run_id": str(run.id), "area": {"id": str(area_id), "name": area.name if area else None},
            "shared": {"product_version": (snap.get("product") or {}).get("version"),
                       "constraints_version": (snap.get("constraints") or {}).get("version"),
                       "ad_spend_budget": (snap.get("constraints") or {}).get("ad_spend_budget"),
                       "note": "Same run, city, practical places, product facts and budget; only the audience differs."},
            "a": A, "b": B, "differences": diff, "changed": changed,
            "summary": ("The two audiences lead to different shortlists or emphasis." if changed else
                        "No material difference: both audiences produce the same shortlist order and emphasis here.")}


# ---------------------------------------------------------- revision preview -
async def revision_preview(s: AsyncSession, project_id: uuid.UUID, body) -> dict:
    """Dry run of /revisions/apply: lists what would be marked stale or re-run.
    Writes nothing and makes no provider calls."""
    from ..errors import AppError

    async def briefs_media(q):
        briefs = (await s.execute(q)).scalars().all()
        ids = [b.id for b in briefs]
        media = 0
        if ids:
            media = (await s.execute(select(func.count()).select_from(Asset).where(
                Asset.brief_id.in_(ids), Asset.stale.is_(False), Asset.deleted_at.is_(None),
                Asset.kind.in_(("flyer", "video_final", "video_animatic"))))).scalar_one()
        return [{"id": str(b.id), "label": f"{b.language} {b.channel} brief v{b.version}"} for b in briefs], media

    def strat_items(svs, names):
        return [{"id": str(x.id), "label": f"{names.get(x.area_id, 'area')} · v{x.version}"} for x in svs]

    names = {a.id: a.name for a in (await s.execute(select(GeographicArea).where(GeographicArea.project_id == project_id))).scalars().all()}
    out = {"kind": body.kind, "writes": "none (preview)", "provider_calls": "none (preview)"}
    if body.kind in ("exclude_region", "set_ad_budget"):
        cv = await ctxsvc.latest_constraints(s, project_id)
        if cv is None:
            raise AppError(409, "no_constraints", "No constraints to revise.")
        if body.kind == "exclude_region":
            if not body.region_name or not any(r["name"].lower() == body.region_name.lower() for r in cv.candidate_regions):
                raise AppError(422, "unknown_region", "Name one of the candidate locations.")
            aids = [k for k, v in names.items() if v.lower() == body.region_name.lower()]
            svs = (await s.execute(select(StrategyVersion).where(StrategyVersion.project_id == project_id,
                                                                 StrategyVersion.area_id.in_(aids),
                                                                 StrategyVersion.stale.is_(False)))).scalars().all()
            out["summary"] = f"Exclude {body.region_name} from the launch"
            out["affected"] = {"research": "re-run required: the excluded city becomes ineligible regardless of taste signals",
                               "strategies_for_this_city": strat_items(svs, names),
                               "other_cities": "re-ranked from cached evidence"}
        else:
            out["summary"] = f"Set the ad budget to {body.ad_spend_budget} (was {_f(cv.ad_spend_budget)})"
            out["affected"] = {"research": "re-run required: budget feasibility is re-checked for every city",
                               "strategies": "re-checked by input hash after the re-run; unchanged pairs are reused"}
        out["preserved"] = {"provider_cache": "Places, climate and Qloo responses are reused when the query is unchanged",
                            "previous_runs": "kept for comparison", "media": "kept until a re-run changes its strategy"}
        out["cost_if_applied"] = "Re-running research reuses cached provider data; new Qloo calls are bounded by the run budget."
    elif body.kind in ("disable_feature", "enable_feature"):
        pv = await ctxsvc.latest_product(s, project_id)
        feat = next((f for f in (pv.features if pv else []) if f.key == body.feature_key), None)
        if feat is None:
            raise AppError(422, "unknown_feature", "Name an existing feature key.")
        svs = (await s.execute(select(StrategyVersion).where(StrategyVersion.project_id == project_id,
                                                             StrategyVersion.product_version_id == pv.id,
                                                             StrategyVersion.stale.is_(False)))).scalars().all()
        briefs, media = await briefs_media(select(CreativeBrief).where(CreativeBrief.project_id == project_id,
                                                                       CreativeBrief.product_version_id == pv.id,
                                                                       CreativeBrief.stale.is_(False)))
        claims = (await s.execute(select(func.count()).select_from(Claim).where(
            Claim.product_version_id == pv.id, Claim.feature_key == body.feature_key))).scalar_one()
        verb = "Disable" if body.kind == "disable_feature" else "Enable"
        out["summary"] = f"{verb} the feature '{feat.name}'"
        out["affected"] = {"strategies": strat_items(svs, names), "briefs": briefs, "media_to_rerender": media,
                           "claims_dropped": claims if body.kind == "disable_feature" else 0,
                           "research": "not affected"}
        out["preserved"] = {"research": "Places, climate and taste evidence are unchanged", "previous_versions": "kept"}
        out["cost_if_applied"] = "No provider calls. Regenerating strategies or media later follows the normal review and caps."
    elif body.kind == "change_audience_role":
        aud = await s.get(Audience, body.audience_id) if body.audience_id else None
        if aud is None or aud.project_id != project_id or body.role is None:
            raise AppError(422, "audience_required", "Give the audience id and the new role.")
        av = (await s.execute(select(AudienceVersion).where(AudienceVersion.audience_id == aud.id)
                              .order_by(AudienceVersion.version.desc()).limit(1))).scalar_one()
        svs = (await s.execute(select(StrategyVersion).where(StrategyVersion.audience_version_id == av.id,
                                                             StrategyVersion.stale.is_(False)))).scalars().all()
        briefs, media = await briefs_media(select(CreativeBrief).where(CreativeBrief.audience_version_id == av.id,
                                                                       CreativeBrief.stale.is_(False)))
        out["summary"] = f"Change {av.name}'s role from {av.role.replace('_', ' ')} to {body.role.replace('_', ' ')}"
        out["affected"] = {"strategies": strat_items(svs, names), "briefs": briefs, "media_to_rerender": media,
                           "research": "re-run recommended: placements are re-scored for the new role"}
        out["preserved"] = {"other_audiences": "untouched", "interests": "kept (copied to the new version)",
                            "places_and_climate": "reused"}
        out["cost_if_applied"] = "A re-run reuses cached Qloo responses for unchanged interests."
    else:
        raise AppError(422, "unknown_kind", "Unsupported revision kind.")
    return out


# ------------------------------------------------------------- Feature D ----
async def creative_trace(s: AsyncSession, b: CreativeBrief) -> dict:
    sv = await s.get(StrategyVersion, b.strategy_version_id)
    pv = await s.get(ProductVersion, b.product_version_id)
    av = await s.get(AudienceVersion, b.audience_version_id)
    area = await s.get(GeographicArea, b.area_id)
    c = sv.content if sv else {}
    decisions = b.decisions or []
    ids = {i for d in decisions for i in d.get("evidence_ids") or []}
    ids |= {i for r in (c.get("key_messages") or []) + (c.get("supporting_benefits") or []) for i in r.get("evidence_ids") or []}
    ids |= set((c.get("main_feature_rationale") or {}).get("evidence_ids") or [])
    known = await _evidence(s, b.project_id, ids)

    def refs(lst):
        return [{"id": i, **(_ev_brief(known[i]) if i in known else {"nature": "unknown", "title": "Unknown evidence id"})}
                for i in lst or []]
    feat = next((f for f in (pv.features if pv else []) if sv and f.key == c.get("main_feature_key")), None)
    claims = (await s.execute(select(Claim).where(Claim.product_version_id == b.product_version_id,
                                                  Claim.approved.is_(True)))).scalars().all()
    pick_ids = [x.get("placement_id") for x in (c.get("partner_shortlist") or []) + (c.get("placement_options") or [])]
    placement = None
    for pid in pick_ids:
        try:
            pc = await s.get(PlacementCandidate, uuid.UUID(pid))
        except (ValueError, TypeError):
            pc = None
        if pc and pc.project_id == b.project_id:
            placement = pc
            break
    content = b.content or {}
    kpis = c.get("kpis_to_test") or []
    pilot = c.get("pilot_plan") or {}
    siblings = (await s.execute(select(CreativeBrief).where(CreativeBrief.project_id == b.project_id,
                                                            CreativeBrief.area_id == b.area_id,
                                                            CreativeBrief.is_current.is_(True),
                                                            CreativeBrief.id != b.id))).scalars().all()
    sib_aud = {x.audience_version_id for x in siblings}
    aud_names = {a.id: a.name for a in (await s.execute(select(AudienceVersion).where(AudienceVersion.id.in_(sib_aud)))).scalars().all()} if sib_aud else {}
    results = (await s.execute(select(func.count()).select_from(CampaignResult).where(CampaignResult.brief_id == b.id))).scalar_one()
    return {
        "brief_id": str(b.id), "version": b.version, "language": b.language, "channel": b.channel,
        "copy": {k: content.get(k) for k in ("headline", "body", "cta", "disclaimer")},
        "translation_status": b.translation_status,
        "chain": {
            "product_fact": {"feature_key": c.get("main_feature_key"), "name": feat.name if feat else None,
                             "mechanism": feat.mechanism if feat else None, "evidence_status": feat.evidence_status if feat else None,
                             "source": feat.source if feat else None, "nature": "product_fact",
                             "operating_conditions": feat.operating_conditions if feat else None},
            "strategy": {"id": str(sv.id) if sv else None, "positioning": c.get("positioning"),
                         "main_feature_rationale": (c.get("main_feature_rationale") or {}).get("text"),
                         "rationale_evidence": refs((c.get("main_feature_rationale") or {}).get("evidence_ids")),
                         "key_messages": [{"text": r.get("text"), "evidence": refs(r.get("evidence_ids"))}
                                          for r in c.get("key_messages") or []],
                         "generated": True, "generator": (sv.generator or {}).get("type") if sv else None},
            "decisions": [{"decision": d.get("decision"), "rationale": d.get("rationale"),
                           "nature": "evidence" if d.get("kind") == "evidence" and d.get("evidence_ids") else "generated_hypothesis",
                           "evidence": refs(d.get("evidence_ids"))} for d in decisions],
            "approved_claims": [{"id": str(x.id), "text": x.text, "support_status": x.support_status,
                                 "feature_key": x.feature_key} for x in claims],
        },
        "pilot_card": {
            "label": "Pilot hypothesis — planned, not a result",
            "audience": {"name": av.name if av else None, "role": av.role if av else None},
            "area": area.name if area else None,
            "placement": {"id": str(placement.id), "name": placement.name, "status": placement.status,
                          "next_action": placement.next_action} if placement else None,
            "message": content.get("headline"),
            "measurement": {"metric": kpis[0].get("metric") if kpis else None,
                            "target_to_test": kpis[0].get("target_to_test") if kpis else None,
                            "objective": pilot.get("objective"), "duration_weeks": pilot.get("duration_weeks")},
            "results_recorded": results,
            "results_note": "Measured results live on the Results page and are never mixed with this plan."},
        "variants": [{"brief_id": str(x.id), "audience": aud_names.get(x.audience_version_id), "language": x.language,
                      "headline": (x.content or {}).get("headline"), "strategy_version_id": str(x.strategy_version_id),
                      "same_audience": x.audience_version_id == b.audience_version_id} for x in siblings],
        "unknown_evidence_ids": sorted(ids - set(known)),
    }


# ------------------------------------------------------------- Feature E ----
async def opportunities(s: AsyncSession, run: ResearchRun, limit: int = 3) -> dict:
    """Taste-relevant practical candidates not yet shortlisted, in eligible
    areas only. Affinity and popularity are shown separately; nothing is
    called 'low competition'."""
    las = (await s.execute(select(LocationAssessment).where(LocationAssessment.run_id == run.id))).scalars().all()
    eligible = {la.area_id for la in las if la.eligible}
    if not run.qloo_enabled or not eligible:
        return {"run_id": str(run.id), "items": [], "message": "No eligible areas with Qloo signals in this run."}
    pcs = (await s.execute(select(PlacementCandidate).where(
        PlacementCandidate.run_id == run.id, PlacementCandidate.area_id.in_(eligible),
        PlacementCandidate.shortlisted.is_(False), PlacementCandidate.place_id.is_not(None)))).scalars().all()
    shortlisted_places = {pc.place_id for pc in (await s.execute(select(PlacementCandidate).where(
        PlacementCandidate.run_id == run.id, PlacementCandidate.shortlisted.is_(True)))).scalars().all()}
    cands = [pc for pc in pcs if (pc.qloo_relevance or {}).get("affinity_rank_in_candidates") is not None
             and pc.place_id not in shortlisted_places]
    cands.sort(key=lambda pc: (-(pc.qloo_relevance["affinity_rank_in_candidates"]), -float(pc.suitability_score or 0)))
    # integer affinity rank among all candidates (shortlisted or not) for the same area and audience
    rank_of: dict = {}
    groups: dict = {}
    for pc in pcs + [x for x in (await s.execute(select(PlacementCandidate).where(
            PlacementCandidate.run_id == run.id, PlacementCandidate.shortlisted.is_(True)))).scalars().all()]:
        aff = (pc.qloo_relevance or {}).get("affinity")
        if aff is not None:
            groups.setdefault((pc.area_id, pc.audience_version_id), []).append(pc)
    for g in groups.values():
        g.sort(key=lambda x: -x.qloo_relevance["affinity"])
        for i, x in enumerate(g, start=1):
            rank_of[x.id] = (i, len(g))
    snap = run.input_snapshot or {}
    auds = {a["id"]: a for a in snap.get("audiences") or []}
    areas = {a.id: a.name for a in (await s.execute(select(GeographicArea).where(GeographicArea.id.in_(eligible)))).scalars().all()}
    seen, items = set(), []
    for pc in cands:
        if pc.place_id in seen:
            continue
        seen.add(pc.place_id)
        place = await s.get(Place, pc.place_id)
        aud = auds.get(str(pc.audience_version_id)) or {}
        unknown = [k for k, v in (pc.verification or {}).items() if v == "unknown"]
        items.append({
            "placement_id": str(pc.id), "name": pc.name, "category": pc.category, "area": areas.get(pc.area_id),
            "area_id": str(pc.area_id), "audience": {"id": str(pc.audience_version_id), "name": aud.get("name")},
            "signal": {"affinity": pc.qloo_relevance.get("affinity"),
                       "affinity_rank_in_candidates": pc.qloo_relevance.get("affinity_rank_in_candidates"),
                       "relative_affinity_score": pc.qloo_relevance.get("affinity_rank_in_candidates"),
                       "affinity_rank": rank_of.get(pc.id, (None, None))[0],
                       "affinity_rank_of": rank_of.get(pc.id, (None, None))[1],
                       "popularity": (place.metadata_ or {}).get("qloo_popularity") if place else None,
                       "meaning": "Affinity = taste relevance to this audience's interests; popularity = Qloo's general "
                                  "popularity percentile. Neither measures competition, footfall or willingness to partner."},
            "constraints": {"unknown": unknown, "accessibility": pc.accessibility, "status": pc.status,
                            "distance_m": _f(place.distance_m) if place else None},
            "pilot_proposal": {"generated_from_template": True,
                               "text": f"Two-week {pc.activation.replace('_', ' ')} at {pc.name} for {aud.get('name', 'this audience')}: "
                                       f"confirm {', '.join(unknown[:3]) or 'terms'} first, then count enquiries from a unique QR code."},
            "next_action": pc.next_action})
        if len(items) >= limit:
            break
    return {"run_id": str(run.id), "items": items,
            "message": None if items else "Every taste-relevant candidate is already shortlisted."}


# ------------------------------------------------------------- journey ------
STAGES = ("brief", "audience", "explore", "strategy", "create", "export")
STAGE_LABEL = {"brief": "Brief", "audience": "Audience", "explore": "Explore", "strategy": "Strategy",
               "create": "Create", "export": "Export"}
STAGE_PATH = {"brief": "brief", "audience": "audiences", "explore": "explorer", "strategy": "strategy",
              "create": "studio", "export": "assets"}


async def journey(s: AsyncSession, project_id: uuid.UUID, locked: bool = False) -> dict:
    base = f"/projects/{project_id}"
    pv = await ctxsvc.latest_product(s, project_id)
    cv = await ctxsvc.latest_constraints(s, project_id)
    avs = await ctxsvc.latest_audiences(s, project_id)
    photo = (await s.execute(select(func.count()).select_from(ProductAsset).where(
        ProductAsset.project_id == project_id, ProductAsset.role == "product_photo"))).scalar_one()
    av_ids = [a.id for a in avs]
    ents = (await s.execute(select(ResolvedEntity).where(ResolvedEntity.project_id == project_id,
                                                         ResolvedEntity.audience_version_id.in_(av_ids)))).scalars().all() if av_ids else []
    run = (await s.execute(select(ResearchRun).where(ResearchRun.project_id == project_id, ResearchRun.qloo_enabled.is_(True))
                           .order_by(ResearchRun.created_at.desc()).limit(1))).scalar_one_or_none()
    n_strat = (await s.execute(select(func.count()).select_from(StrategyVersion).where(
        StrategyVersion.project_id == project_id, StrategyVersion.stale.is_(False)))).scalar_one()
    briefs = (await s.execute(select(CreativeBrief).where(CreativeBrief.project_id == project_id,
                                                          CreativeBrief.is_current.is_(True)))).scalars().all()
    n_media = (await s.execute(select(func.count()).select_from(Asset).where(
        Asset.project_id == project_id, Asset.kind.in_(("flyer", "video_final")), Asset.deleted_at.is_(None),
        Asset.stale.is_(False)))).scalar_one()
    n_export = (await s.execute(select(func.count()).select_from(Export).where(Export.project_id == project_id,
                                                                               Export.status == "completed"))).scalar_one()
    stages: dict[str, dict] = {k: {"key": k, "label": STAGE_LABEL[k], "path": f"{base}/{STAGE_PATH[k]}", "blockers": [],
                                   "done": False, "summary": ""} for k in STAGES}

    def block(stage, msg, anchor, fix):
        stages[stage]["blockers"].append({"message": msg, "to": f"{base}/{STAGE_PATH[stage]}#{anchor}", "fix": fix})

    if not pv:
        block("brief", "Product facts are missing.", "product", "Add product facts")
    if not cv or not cv.candidate_regions:
        block("brief", "No candidate cities chosen.", "constraints", "Choose candidate cities")
    if not photo:
        block("brief", "No product photo uploaded — ads need the real product.", "media", "Upload a product photo")
    stages["brief"]["done"] = not stages["brief"]["blockers"]
    stages["brief"]["summary"] = f"Product v{pv.version}" if pv else "Not started"

    if not avs:
        block("audience", "No audience defined.", "new-audience", "Add an audience")
    for e in ents:
        if e.status in ("ambiguous", "pending"):
            block("audience", f"Interest “{e.query_text}” needs a decision.", f"entity-{e.id}", "Choose the right match")
    resolved = sum(1 for e in ents if e.status in ("resolved", "proxy"))
    stages["audience"]["done"] = bool(avs) and not stages["audience"]["blockers"]
    stages["audience"]["summary"] = f"{len(avs)} audiences · {resolved} interests resolved"

    if run is None:
        stages["explore"]["summary"] = "No research yet"
    else:
        stages["explore"]["summary"] = f"Research {run.status.replace('_', ' ')}"
        if run.status == "waiting_for_user":
            block("explore", (run.pending_decision or {}).get("title") or "Research is waiting for your decision.",
                  "decision", "Answer the question")
        elif run.status in ("failed", "cancelled"):
            block("explore", f"The last research run {run.status}.", "runs", "Start research again")
    stages["explore"]["done"] = bool(run and run.status in ("completed", "partially_completed"))
    stages["strategy"]["done"] = n_strat > 0
    stages["strategy"]["summary"] = f"{n_strat} current strategies" if n_strat else "None yet"
    approved = [b for b in briefs if b.approval_state == "approved"]
    stages["create"]["done"] = n_media > 0
    stages["create"]["summary"] = f"{len(briefs)} briefs · {n_media} ads"
    stages["export"]["done"] = n_export > 0
    stages["export"]["summary"] = f"{n_export} packages" if n_export else "Nothing exported"

    current = next((k for k in STAGES if not stages[k]["done"]), "export")
    for k in STAGES:
        stages[k]["status"] = ("done" if stages[k]["done"] and not stages[k]["blockers"] else
                               "attention" if stages[k]["blockers"] else "active" if k == current else "todo")
    nxt = _next_action(current, stages, run, briefs, approved, base, locked)
    if run is not None and run.status == "waiting_for_user" and not locked:
        nxt["decision_run_id"] = str(run.id)
    done = [k for k in STAGES if stages[k]["status"] == "done"]
    return {"project_id": str(project_id), "locked": locked, "current": current,
            "last_completed": STAGE_LABEL[done[-1]] if done else None,
            "stages": [stages[k] for k in STAGES], "next_action": nxt,
            "context": {"run_id": str(run.id) if run else None, "run_status": run.status if run else None,
                        "product_version": pv.version if pv else None}}


def _next_action(current, stages, run, briefs, approved, base, locked) -> dict:
    if locked:
        return {"label": "Explore the sample", "to": f"{base}/explorer",
                "why": "This sample is read-only so every visitor sees the same results. Duplicate it to make changes.",
                "secondary": {"label": "Duplicate to edit", "action": "duplicate"}}
    blockers = stages[current]["blockers"]
    if blockers:
        b = blockers[0]
        return {"label": b["fix"], "to": b["to"], "why": b["message"]}
    if current == "explore":
        if run and run.status in ("queued", "running"):
            return {"label": "Watch research progress", "to": f"{base}/explorer", "why": "Research is running now."}
        return {"label": "Start research", "to": f"{base}/explorer#start",
                "why": "Compare candidate cities on practical evidence and Qloo taste signals."}
    if current == "strategy":
        return {"label": "Create a strategy", "to": f"{base}/strategy",
                "why": "Turn a city and audience into a testable launch hypothesis."}
    if current == "create":
        if not briefs:
            return {"label": "Write a creative brief", "to": f"{base}/strategy#handoff", "why": "Ads are made from an approved brief."}
        if not approved:
            return {"label": "Review and approve a brief", "to": f"{base}/studio", "why": "Generation starts only after approval."}
        return {"label": "Generate ads", "to": f"{base}/studio", "why": "Your brief is approved; preview the cost first."}
    if current == "export":
        return {"label": "Download the campaign package", "to": f"{base}/assets", "why": "Bundle approved ads, strategy and evidence."}
    return {"label": "Review results", "to": f"{base}/results", "why": "Everything is ready. Record pilot results when you have them."}
