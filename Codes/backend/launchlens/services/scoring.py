"""Deterministic, reproducible location scoring. No model is involved here.

1. Hard constraints first. A location that fails one is excluded, whatever
   its cultural affinity. Unknown is not a failure and not a pass: it is
   reported as unknown.
2. Each component is made comparable by a rank-based transform across the
   eligible candidates, computed from values gathered in the same query
   context (same radius, same categories, same signals). Original provider
   values are kept alongside.
3. The planning index is sum(w_i * c_i) over AVAILABLE components only, and is
   never renormalised. available_weight says how much of the index exists.
   A location missing any component is "incomplete" and is not ranked against
   complete ones.
4. Evidence coverage is a completeness share, not a confidence interval.
All indices are application planning indices, not forecasts.
"""
from __future__ import annotations

from dataclasses import dataclass, field

DEFAULT_WEIGHTS = {
    "partner_access": 0.25,      # retrieved partner/institution places in radius (practical)
    "venue_access": 0.15,        # retrieved demo venues in radius (practical)
    "feature_relevance": 0.20,   # climate-derived fan-relevance hypothesis input (practical)
    "competitive_room": 0.10,    # fewer inferred category peers -> more room (practical, hypothesis)
    "cultural_fit": 0.30,        # Qloo affinity of nearby places to audience signals (provider signal)
}
PRACTICAL = ("partner_access", "venue_access", "feature_relevance", "competitive_room")
COMPONENT_LABELS = {
    "partner_access": "Partner access", "venue_access": "Demo venue access",
    "feature_relevance": "Feature relevance (hypothesis)", "competitive_room": "Competitive room",
    "cultural_fit": "Cultural fit (Qloo)",
}
EXPECTED_TOPICS = ("service", "places", "climate", "taste", "budget")


@dataclass
class Candidate:
    area_id: str
    name: str
    country_code: str
    lat: float
    lon: float
    raw: dict = field(default_factory=dict)          # component -> raw value or None
    raw_meta: dict = field(default_factory=dict)     # component -> {units, evidence_ids, note}
    topics_present: set = field(default_factory=set)
    hard: list = field(default_factory=list)         # [{name, result: pass|fail|unknown, reason, evidence_ids}]


def rank_transform(values: dict[str, float | None], higher_is_better: bool = True) -> dict[str, float | None]:
    """Average-rank percentile in [0,1] among non-missing values. One value -> 0.5."""
    present = {k: v for k, v in values.items() if v is not None}
    out: dict[str, float | None] = {k: None for k in values}
    n = len(present)
    if n == 0:
        return out
    if n == 1:
        out[next(iter(present))] = 0.5
        return out
    ordered = sorted(present.items(), key=lambda kv: kv[1], reverse=not higher_is_better)
    i = 0
    while i < n:
        j = i
        while j + 1 < n and ordered[j + 1][1] == ordered[i][1]:
            j += 1
        avg_rank = (i + j) / 2  # 0 = worst
        for k in range(i, j + 1):
            out[ordered[k][0]] = round(avg_rank / (n - 1), 4)
        i = j + 1
    return out


def evaluate_hard(c: Candidate) -> tuple[bool, str]:
    failed = [h for h in c.hard if h["result"] == "fail"]
    if failed:
        return False, "; ".join(h["reason"] for h in failed)
    return True, ""


def score(candidates: list[Candidate], weights: dict | None = None, *, qloo_enabled: bool = True) -> list[dict]:
    w = {**DEFAULT_WEIGHTS, **(weights or {})}
    total_w = sum(w.values())
    eligible = [c for c in candidates if evaluate_hard(c)[0]]
    higher = {"partner_access": True, "venue_access": True, "feature_relevance": True,
              "competitive_room": False, "cultural_fit": True}
    ranks = {comp: rank_transform({c.area_id: c.raw.get(comp) for c in eligible}, higher[comp]) for comp in w}
    results = []
    for c in candidates:
        ok, why = evaluate_hard(c)
        coverage = round(len(c.topics_present & set(EXPECTED_TOPICS)) / len(EXPECTED_TOPICS), 4)
        if not ok:
            results.append({"area_id": c.area_id, "name": c.name, "eligible": False, "status": "excluded",
                            "exclusion_reason": why, "hard_constraints": c.hard, "components": {},
                            "practical_index": None, "cultural_index": None, "planning_index": None,
                            "available_weight": 0.0, "evidence_coverage": coverage, "weights": w})
            continue
        comps = {}
        avail_w = 0.0
        index = 0.0
        for comp, weight in w.items():
            norm = ranks[comp].get(c.area_id)
            meta = c.raw_meta.get(comp, {})
            state = "available" if norm is not None else ("disabled_by_experiment" if comp == "cultural_fit" and not qloo_enabled else "missing")
            comps[comp] = {"label": COMPONENT_LABELS[comp], "raw": c.raw.get(comp), "normalized": norm,
                           "weight": weight, "contribution": round(norm * weight, 4) if norm is not None else None,
                           "state": state, "higher_is_better": higher[comp], **meta}
            if norm is not None:
                avail_w += weight
                index += norm * weight
        pw = sum(w[k] for k in PRACTICAL)
        p_avail = [comps[k] for k in PRACTICAL if comps[k]["normalized"] is not None]
        practical = (round(sum(x["normalized"] * x["weight"] for x in p_avail) / pw, 4)
                     if len(p_avail) == len(PRACTICAL) else None)
        cultural = comps["cultural_fit"]["normalized"]
        complete = abs(avail_w - total_w) < 1e-9
        results.append({
            "area_id": c.area_id, "name": c.name, "eligible": True,
            "status": "complete" if complete else "incomplete", "hard_constraints": c.hard, "components": comps,
            "practical_index": practical, "cultural_index": cultural,
            "planning_index": round(index, 4), "available_weight": round(avail_w / total_w, 4),
            "evidence_coverage": coverage, "weights": w,
        })
    complete = sorted([r for r in results if r["status"] == "complete"], key=lambda r: -r["planning_index"])
    for i, r in enumerate(complete, 1):
        r["rank"] = i
    practical_ranked = sorted([r for r in results if r["eligible"] and r["practical_index"] is not None],
                              key=lambda r: -r["practical_index"])
    for i, r in enumerate(practical_ranked, 1):
        r["practical_rank"] = i
    for r in results:
        r.setdefault("rank", None)
        r.setdefault("practical_rank", None)
    return results


def budget_scenario(total: float | None, currency: str, placements: list[dict], *, digital_share: float = 0.4,
                    reserve_share: float = 0.1) -> dict:
    """Split a user-supplied pilot ad budget across selected placements.
    A planning scenario only: no observed advertising prices are implied."""
    if total is None or total <= 0:
        return {"status": "no_budget", "note": "No ad-spend budget supplied; allocation not computed.",
                "currency": currency, "lines": []}
    physical = [p for p in placements if p.get("channel_type") != "digital_geo"]
    digital = [p for p in placements if p.get("channel_type") == "digital_geo"]
    reserve = round(total * reserve_share, 2)
    d_total = round(total * digital_share, 2) if digital else 0.0
    p_total = round(total - reserve - d_total, 2)
    lines = []
    for p in digital:
        lines.append({"placement": p["name"], "channel_type": p["channel_type"],
                      "amount": round(d_total / len(digital), 2), "basis": f"{int(digital_share * 100)}% digital share split evenly"})
    for p in physical:
        lines.append({"placement": p["name"], "channel_type": p["channel_type"],
                      "amount": round(p_total / len(physical), 2) if physical else 0.0,
                      "basis": "remaining share split evenly across selected physical placements"})
    basis = f"{int(reserve_share * 100)}% held for verified opportunities"
    if not physical and lines:
        reserve = round(total - sum(line["amount"] for line in lines), 2)
        basis = (f"{reserve / total:.0%} held: no physical placement selected yet, so everything beyond the "
                 f"{int(digital_share * 100)}% digital share waits for verified opportunities")
    lines.append({"placement": "Unallocated reserve", "channel_type": "reserve", "amount": reserve, "basis": basis})
    allocated = round(sum(line["amount"] for line in lines), 2)
    if abs(allocated - total) >= 0.01:
        lines[-1]["amount"] = round(lines[-1]["amount"] + (total - allocated), 2)
    return {"status": "scenario", "total": total, "currency": currency, "lines": lines,
            "assumptions": ["Even splits are a starting scenario, not a recommendation of observed prices.",
                            "Actual placement costs are unknown until each placement is verified."],
            "formula": "digital = total*digital_share; reserve = total*reserve_share; physical = remainder/n"}
