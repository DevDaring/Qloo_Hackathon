"""The with/without-Qloo experiment, made defensible.

* The no-Qloo arm starts from the baseline run's immutable input snapshot
  (product, constraints, audiences, resolved signals) and a byte-identical copy
  of the baseline's practical evidence and OSM places. Nothing is re-queried,
  so cache expiry or later project edits cannot change the comparison.
* Practical equality is checked per area identity + topic + content hash, and
  per area's OSM place-ID set, so values swapped between cities are detected.
* Runtime configuration of both arms is recorded and differences are reported
  as confounders.
* Two analyses are kept apart: RANKING-ONLY (the same fixed candidate set
  re-ordered with Qloo affinity) and DISCOVERY (venues Qloo introduced).
* The no-Qloo arm is shown with its practical rank; the cultural weight is not
  silently redistributed. "No material change" is a legitimate outcome.
* Owner ratings can be given blind (A/B) and are revealed afterwards.
"""
from __future__ import annotations

import hashlib
import json
import random
import re
import uuid
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import func, select

from ..db import session_scope
from ..models import (
    EvidenceRecord, Experiment, GeographicArea, LocationAssessment, Place, PlacementCandidate, ResearchRun,
    StrategyVersion, UsageLedger,
)

PRACTICAL_TOPICS = ("places", "climate", "feature_relevance", "noise", "footfall", "income", "accessibility",
                    "ad_inventory")
SNAPSHOT_COMPARE_KEYS = ("product", "constraints", "audiences", "entities", "claims")


def _h(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()[:16]


class BaselineError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


async def validate_baseline(project_id: uuid.UUID, base: ResearchRun) -> None:
    if base.project_id != project_id:
        raise BaselineError("baseline_other_project", "The baseline run belongs to a different project.")
    if not base.qloo_enabled:
        raise BaselineError("baseline_without_qloo", "Choose a run that used Qloo as the baseline.")
    if base.status not in ("waiting_for_user", "completed", "partially_completed"):
        raise BaselineError("baseline_incomplete", f"The baseline run is {base.status}; wait for its research to finish.")
    async with session_scope() as s:
        n_assess = (await s.execute(select(func.count()).select_from(LocationAssessment)
                                    .where(LocationAssessment.run_id == base.id))).scalar_one()
        usable = (await s.execute(select(func.count()).select_from(EvidenceRecord).where(
            EvidenceRecord.run_id == base.id, EvidenceRecord.kind.in_(("derived_metric", "provider_signal")),
            EvidenceRecord.topic.in_(("taste_common", "taste")), EvidenceRecord.value_numeric.isnot(None)))).scalar_one()
    if not n_assess:
        raise BaselineError("baseline_incomplete", "The baseline run has no location assessments yet.")
    if not usable:
        raise BaselineError("baseline_without_taste_evidence",
                            "The baseline run has no usable Qloo taste evidence, so there is nothing to compare.")


def experiment_snapshot(base: ResearchRun) -> dict:
    snap = json.loads(json.dumps(base.input_snapshot or {}, default=str))
    snap.update({"experiment_arm": "without_qloo", "pinned_practical_from": str(base.id),
                 "baseline_snapshot_at": (base.input_snapshot or {}).get("snapshot_at") or base.created_at.isoformat()})
    snap.pop("previous_selections", None)
    return snap


async def copy_practical(run_id: uuid.UUID, base_run_id: uuid.UUID, area_id: uuid.UUID) -> int:
    """Copy the baseline's practical evidence and OSM places for one area."""
    async with session_scope() as s:
        if (await s.execute(select(EvidenceRecord.id).where(EvidenceRecord.run_id == run_id,
                                                            EvidenceRecord.area_id == area_id).limit(1))).first():
            return 0
        evs = (await s.execute(select(EvidenceRecord).where(
            EvidenceRecord.run_id == base_run_id, EvidenceRecord.area_id == area_id,
            EvidenceRecord.topic.in_(PRACTICAL_TOPICS)))).scalars().all()
        mapping: dict = {}
        for e in evs:
            nid = uuid.uuid4()
            mapping[e.id] = nid
            s.add(EvidenceRecord(
                id=nid, project_id=e.project_id, run_id=run_id, area_id=e.area_id, audience_version_id=e.audience_version_id,
                kind=e.kind, status=e.status, topic=e.topic, title=e.title, statement=e.statement,
                value_numeric=e.value_numeric, units=e.units, source=e.source, source_ref=e.source_ref,
                retrieved_at=e.retrieved_at, period=e.period, scope=e.scope, formula=e.formula,
                input_evidence_ids=e.input_evidence_ids, limitations=e.limitations,
                payload={**(e.payload or {}), "pinned_from": str(e.id)}, redistributable=e.redistributable,
                input_hash=e.input_hash))
        await s.flush()
        places = (await s.execute(select(Place).where(Place.run_id == base_run_id, Place.area_id == area_id,
                                                      Place.provider != "qloo"))).scalars().all()
        for p in places:
            s.add(Place(id=uuid.uuid4(), project_id=p.project_id, run_id=run_id, area_id=p.area_id, provider=p.provider,
                        provider_id=p.provider_id, name=p.name, category=p.category, role=p.role, role_basis=p.role_basis,
                        provider_categories=p.provider_categories, address=p.address, geom=p.geom,
                        distance_m=p.distance_m, accessibility=p.accessibility, metadata_=p.metadata_,
                        qloo_entity_id=p.qloo_entity_id, retrieved_at=p.retrieved_at,
                        evidence_id=mapping.get(p.evidence_id)))
        return len(evs)


async def practical_fingerprint(run_id: uuid.UUID) -> dict:
    """{area_id: {topic|kind: hash, "osm_places": hash}} over practical inputs only."""
    async with session_scope() as s:
        evs = (await s.execute(select(EvidenceRecord).where(
            EvidenceRecord.run_id == run_id, EvidenceRecord.topic.in_(PRACTICAL_TOPICS)))).scalars().all()
        pl = (await s.execute(select(Place.area_id, Place.provider, Place.provider_id).where(
            Place.run_id == run_id, Place.provider != "qloo"))).all()
    out: dict = {}
    for e in evs:
        payload = {k: v for k, v in (e.payload or {}).items() if k != "pinned_from"}
        out.setdefault(str(e.area_id), {})[f"{e.topic}|{e.kind}"] = _h(
            [str(e.value_numeric), e.units, e.statement, e.period, e.scope, payload, e.source])
    by_area: dict = {}
    for aid, prov, pid in pl:
        by_area.setdefault(str(aid), []).append(f"{prov}:{pid}")
    for aid, ids in by_area.items():
        out.setdefault(aid, {})["osm_places"] = _h(sorted(ids))
    return out


def compare_fingerprints(a: dict, b: dict, names: dict) -> list[str]:
    mism = []
    for aid in sorted(set(a) | set(b)):
        fa, fb = a.get(aid, {}), b.get(aid, {})
        for key in sorted(set(fa) | set(fb)):
            if fa.get(key) != fb.get(key):
                mism.append(f"{names.get(aid, aid)}: {key.split('|')[0]} differs")
    return mism


def kendall_tau(order_a: list, order_b: list) -> float | None:
    common = [x for x in order_a if x in set(order_b)]
    n = len(common)
    if n < 2:
        return None
    pos_b = {x: i for i, x in enumerate([y for y in order_b if y in set(common)])}
    conc = disc = 0
    for i in range(n):
        for j in range(i + 1, n):
            if pos_b[common[i]] < pos_b[common[j]]:
                conc += 1
            else:
                disc += 1
    return round((conc - disc) / (n * (n - 1) / 2), 3)


def _key(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


async def _arm(s, run: ResearchRun) -> dict:
    las = (await s.execute(select(LocationAssessment).where(LocationAssessment.run_id == run.id))).scalars().all()
    elig = sorted([x for x in las if x.eligible and x.practical_index is not None], key=lambda x: -float(x.practical_index))
    prank = {x.area_id: i for i, x in enumerate(elig, 1)}
    pcs = (await s.execute(select(PlacementCandidate).where(PlacementCandidate.run_id == run.id)
                           .order_by(PlacementCandidate.suitability_score.desc().nullslast()))).scalars().all()
    cost = (await s.execute(select(func.coalesce(func.sum(func.coalesce(UsageLedger.actual_usd, UsageLedger.estimated_usd)), 0))
                            .where(UsageLedger.run_id == run.id, UsageLedger.state != "released"))).scalar_one()
    stages = run.stage_statuses or {}
    done = (stages.get("placement_researcher") or {}).get("at")
    latency = None
    if done:
        latency = round((datetime.fromisoformat(done) - run.created_at).total_seconds(), 1)
    svs = (await s.execute(select(StrategyVersion).where(StrategyVersion.run_id == run.id))).scalars().all()
    return {"run": run, "assessments": {x.area_id: x for x in las}, "practical_rank": prank, "placements": pcs,
            "cost_usd": float(Decimal(str(cost))), "latency_s": latency,
            "strategies": {(sv.area_id, sv.audience_version_id): sv for sv in svs},
            "qloo_counts": (run.counts or {}).get("qloo")}


async def analyse(ex: Experiment) -> dict:
    async with session_scope() as s:
        a_run = await s.get(ResearchRun, ex.run_with_qloo_id)
        b_run = await s.get(ResearchRun, ex.run_without_qloo_id)
        A, B = await _arm(s, a_run), await _arm(s, b_run)
        areas = {x.id: x.name for x in (await s.execute(select(GeographicArea).where(
            GeographicArea.project_id == ex.project_id))).scalars().all()}
        qplaces = (await s.execute(select(Place).where(Place.run_id == a_run.id, Place.provider == "qloo"))).scalars().all()
    names = {str(k): v for k, v in areas.items()}
    fa, fb = await practical_fingerprint(a_run.id), await practical_fingerprint(b_run.id)
    mismatches = compare_fingerprints(fa, fb, names)
    snap_a, snap_b = a_run.input_snapshot or {}, b_run.input_snapshot or {}
    snapshot_diffs = [k for k in SNAPSHOT_COMPARE_KEYS if _h(snap_a.get(k)) != _h(snap_b.get(k))]
    rt_a, rt_b = snap_a.get("runtime") or {}, snap_b.get("runtime") or {}
    confounders = [f"{k}: {rt_a.get(k)} vs {rt_b.get(k)}" for k in sorted(set(rt_a) | set(rt_b)) if rt_a.get(k) != rt_b.get(k)]
    pinned = snap_b.get("pinned_practical_from") == str(a_run.id)

    # locations: planning rank (with Qloo) vs practical rank (without) — never an equivalent full index
    loc_rows = []
    for aid, name in areas.items():
        x, y = A["assessments"].get(aid), B["assessments"].get(aid)
        if not x and not y:
            continue
        loc_rows.append({
            "area_id": str(aid), "area": name,
            "with_qloo": {"eligible": x.eligible, "status": x.status, "rank": x.rank,
                          "planning_index": float(x.planning_index) if x.planning_index is not None else None,
                          "cultural_state": ((x.components or {}).get("cultural_fit") or {}).get("cultural_state"),
                          "cultural_log2_lift": ((x.components or {}).get("cultural_fit") or {}).get("raw")} if x else None,
            "without_qloo": {"eligible": y.eligible, "status": y.status, "practical_rank": B["practical_rank"].get(aid),
                             "practical_index": float(y.practical_index) if y.practical_index is not None else None,
                             "note": "Practical evidence only; the cultural weight is absent, not redistributed."} if y else None,
            "hard_constraints_identical": bool(x and y and [(h["name"], h["result"]) for h in x.hard_constraints] ==
                                               [(h["name"], h["result"]) for h in y.hard_constraints])})
    with_order = [r["area"] for r in sorted([r for r in loc_rows if r["with_qloo"] and r["with_qloo"]["rank"]],
                                            key=lambda r: r["with_qloo"]["rank"])]
    without_order = [r["area"] for r in sorted([r for r in loc_rows if r["without_qloo"] and r["without_qloo"]["practical_rank"]],
                                               key=lambda r: r["without_qloo"]["practical_rank"])]

    # placements per audience x area
    def group(pcs):
        g: dict = {}
        for p in pcs:
            if p.channel_type == "digital_geo":
                continue
            g.setdefault((p.area_id, p.audience_version_id), []).append(p)
        return g
    ga, gb = group(A["placements"]), group(B["placements"])
    aff_by = {}
    for q in qplaces:
        for aud, val in ((q.metadata_ or {}).get("qloo_affinity_by_audience") or {}).items():
            if val is not None:
                aff_by.setdefault((q.area_id, aud), {})[_key(q.name)] = float(val)
    from . import scoring
    ranking_rows, discovery_rows = [], []
    for key in sorted(set(ga) | set(gb), key=str):
        area_id, aud_id = key
        base_list = gb.get(key, [])
        with_list = ga.get(key, [])
        # RANKING-ONLY: the practical arm's fixed candidate set, re-scored with Qloo affinity where Qloo knows the venue
        affs = aff_by.get((area_id, str(aud_id)), {})
        # stable ids (venue names can repeat) and the practical arm's own order by its stored suitability
        cand = [{"id": i, "name": p.name, "fit_prox": float(p.suitability_score or 0), "aff": affs.get(_key(p.name))}
                for i, p in enumerate(base_list)]
        cand.sort(key=lambda c: (-c["fit_prox"], c["id"]))
        ranks = scoring.rank_transform({str(c["id"]): c["aff"] for c in cand})
        practical_order = [c["id"] for c in cand]
        # practical score (0.45 fit + 0.25 proximity) plus the 0.30 affinity term where Qloo knows the venue
        rescored = sorted(cand, key=lambda c: (-(c["fit_prox"] + (0.30 * ranks[str(c["id"])]
                                                                   if ranks.get(str(c["id"])) is not None else 0)), c["id"]))
        taste_order = [c["id"] for c in rescored]
        known = sum(1 for c in cand if c["aff"] is not None)
        tau = kendall_tau(practical_order, taste_order)
        names = {c["id"]: c["name"] for c in cand}
        ranking_rows.append({"area": areas.get(area_id), "audience_version_id": str(aud_id), "candidates": len(cand),
                             "with_qloo_affinity": known, "qloo_knew_none": known == 0,
                             "kendall_tau": tau, "practical_top3": [names[i] for i in practical_order[:3]],
                             "taste_top3": [names[i] for i in taste_order[:3]],
                             "changed": practical_order[:3] != taste_order[:3]})
        # DISCOVERY / END-TO-END: what the full Qloo arm shortlisted vs the practical arm
        base_names = {_key(p.name) for p in base_list}
        with_names = [p.name for p in with_list]
        added = [n for n in with_names if _key(n) not in base_names]
        dropped = [p.name for p in base_list if _key(p.name) not in {_key(n) for n in with_names}]
        union = base_names | {_key(n) for n in with_names}
        overlap = round(len(base_names & {_key(n) for n in with_names}) / len(union), 3) if union else None
        discovery_rows.append({"area": areas.get(area_id), "audience_version_id": str(aud_id), "added_by_qloo": added,
                               "no_longer_shortlisted": dropped, "jaccard_overlap": overlap,
                               "qloo_sourced": sum(1 for p in with_list if p.source == "qloo")})
    emphasis = []
    for k, sv in A["strategies"].items():
        other = B["strategies"].get(k)
        emphasis.append({"area": areas.get(k[0]), "audience_version_id": str(k[1]),
                         "with_qloo": sv.content.get("main_feature_key"),
                         "without_qloo": other.content.get("main_feature_key") if other else None})
    material = (with_order != without_order or any(r["changed"] for r in ranking_rows)
                or any(r["added_by_qloo"] for r in discovery_rows))
    valid = not mismatches and pinned and not snapshot_diffs
    blind = (ex.metrics or {}).get("blind") or {}
    ratings = ex.owner_ratings or {}
    revealed = bool(ratings.get("revealed"))
    blinded = None
    if blind:
        def arm_lists(g):
            return {f"{areas.get(k[0])} · {str(k[1])[:8]}": [p.name for p in v[:8]] for k, v in g.items()}
        lists = {"with": arm_lists(ga), "without": arm_lists(gb)}
        blinded = {"A": lists[blind["A"]], "B": lists[blind["B"]], "mapping": blind if revealed else None,
                   "ratings": {k: v for k, v in ratings.items() if k in ("A", "B", "notes")}}
    return {
        "id": str(ex.id), "recorded_at": ex.created_at.isoformat(),
        "baseline": {"run_id": str(a_run.id), "snapshot_at": snap_a.get("snapshot_at") or a_run.created_at.isoformat()},
        "conditions": ex.conditions,
        "validity": {"valid": valid, "practical_evidence_identical": not mismatches, "mismatches": mismatches,
                     "pinned_to_baseline": pinned, "snapshot_differences": snapshot_diffs, "confounders": confounders},
        "practical_evidence_identical": not mismatches,
        "locations": loc_rows, "location_order": {"with_qloo": with_order, "without_qloo_practical": without_order,
                                                  "changed": with_order != without_order},
        "ranking_only": ranking_rows, "discovery": discovery_rows, "feature_emphasis": emphasis or
        [{"note": "Not computed: the no-Qloo arm stops before strategies, so feature emphasis is not compared."}],
        "cost_latency": {"with_qloo": {"cost_usd": A["cost_usd"], "latency_s": A["latency_s"], "qloo": A["qloo_counts"]},
                         "without_qloo": {"cost_usd": B["cost_usd"], "latency_s": B["latency_s"]}},
        "verdict": ("material change" if material else "no material change"),
        "blinded": blinded,
        "notes": ["A changed recommendation is not evidence of better campaign outcomes; that needs a measured pilot.",
                  "Ranking-only analysis re-orders the practical arm's own candidates; discovery counts venues only "
                  "the Qloo arm surfaced."],
    }


def new_blind() -> dict:
    arms = ["with", "without"]
    random.shuffle(arms)
    return {"A": arms[0], "B": arms[1], "created_at": datetime.now(UTC).isoformat()}
