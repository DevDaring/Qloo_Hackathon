"""Research steps used by the workflow nodes: intake validation, entity
resolution, geographic research, taste analysis, market evaluation and
placement research. Provider calls happen outside database transactions.
"""
from __future__ import annotations

import asyncio
import logging
import re
import uuid
from datetime import UTC, datetime
from decimal import Decimal

from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy import delete, select

from ..config import settings
from ..db import session_scope
from ..models import (
    EvidenceRecord, GeographicArea, LocationAssessment, Place, PlacementCandidate, ResearchRun, ResolvedEntity,
)
from ..providers import geo, qloo
from ..providers.base import ProviderError
from . import context as ctxsvc
from . import evidence as ev
from . import scoring

log = logging.getLogger("launchlens.research")

CRITICAL_PRODUCT_FIELDS = ("name", "description", "category")


# ---------------------------------------------------------------- intake -----
def validate_intake(ctx: dict) -> dict:
    """Critical gaps block claim generation; optional gaps are disclosed."""
    p, c = ctx.get("product"), ctx.get("constraints")
    critical, optional = [], []
    if not p:
        critical.append({"field": "product", "question": "Add the product brief before research."})
    else:
        for f in CRITICAL_PRODUCT_FIELDS:
            if not p.get(f):
                critical.append({"field": f"product.{f}", "question": f"Product {f} is required."})
        if not [f for f in p["features"] if f["enabled"]]:
            critical.append({"field": "product.features", "question": "List at least one product feature."})
        for f in p["features"]:
            for q in f.get("critical_unknowns") or []:
                optional.append({"field": f"feature.{f['key']}", "question": q,
                                 "effect": "Claims about this feature stay blocked until answered."})
        if p.get("price") is None:
            optional.append({"field": "product.price", "question": "Price is unknown; ads will omit a price."})
    if not c or not c.get("candidate_regions"):
        critical.append({"field": "constraints.candidate_regions", "question": "Choose at least one candidate location."})
    elif len(c["candidate_regions"]) > settings.MAX_CANDIDATE_LOCATIONS:
        critical.append({"field": "constraints.candidate_regions",
                         "question": f"At most {settings.MAX_CANDIDATE_LOCATIONS} candidate locations per run."})
    if c and not c.get("service_regions"):
        optional.append({"field": "constraints.service_regions",
                         "question": "Service coverage not set: every candidate is treated as serviceable (assumption)."})
    if c and c.get("ad_spend_budget") is None:
        optional.append({"field": "constraints.ad_spend_budget", "question": "No ad-spend budget: no budget scenario."})
    if not ctx.get("audiences"):
        critical.append({"field": "audiences", "question": "Define at least one audience."})
    return {"critical": critical, "optional": optional, "ok": not critical}


# ---------------------------------------------------------------- entities ---
async def resolve_entities(project_id: uuid.UUID, audiences: list[dict], budget: qloo.CallBudget) -> dict:
    """Resolve each audience's voluntary interests to Qloo entities. Exact,
    unique matches resolve; anything else waits for the owner. A missing
    product entity is never replaced by a vaguely related one."""
    if not qloo.configured():
        return {"status": "unavailable", "ambiguous": [], "message": "Qloo key not configured"}
    async with session_scope() as s:
        existing = {(str(e.audience_version_id), e.query_text.lower()): e for e in
                    (await s.execute(select(ResolvedEntity).where(ResolvedEntity.project_id == project_id))).scalars().all()}
    ambiguous = []
    for a in audiences:
        for interest in a.get("voluntary_interests") or []:
            text = (interest.get("text") if isinstance(interest, dict) else str(interest)).strip()
            if not text:
                continue
            key = (a["id"], text.lower())
            if key in existing and existing[key].status in ("resolved", "proxy", "not_found"):
                continue
            types = [interest.get("type")] if isinstance(interest, dict) and interest.get("type") else None
            try:
                cands, _meta = await qloo.search(text, types, take=6, budget=budget)
            except ProviderError as e:
                if e.kind in ("auth", "not_configured"):
                    return {"status": "unavailable", "ambiguous": [], "message": e.message}
                cands = []
            # Qloo's recommended flow: /search for entities OR /v2/tags for tags.
            # Tags are offered as candidates too (a genre like a music style may exist only as a tag).
            try:
                tag_cands, _ = await qloo.tags(text, take=4, budget=budget)
                cands += [{"qloo_id": t["qloo_id"], "name": t["name"], "type": t.get("type") or "urn:tag",
                           "types": [], "popularity": None, "disambiguation": "Qloo tag", "tags": []}
                          for t in tag_cands if t.get("qloo_id")]
            except ProviderError:
                pass
            # Audience interests are tastes (brands, artists, media, people), never places:
            # Qloo search also returns localities/destinations/venues (e.g. a US town named
            # "Cricket"), which would be wrong signals, so they are excluded.
            cands = [c for c in cands if not set(c.get("types") or [c.get("type") or ""]) &
                     {"urn:entity:locality", "urn:entity:destination", "urn:entity:place"}]
            exact = [c for c in cands if (c["name"] or "").strip().lower() == text.lower()]
            status, chosen = "ambiguous", None
            if len(exact) == 1:
                status, chosen = "resolved", exact[0]
            elif not cands:
                status = "not_found"
            async with session_scope() as s:
                row = existing.get(key)
                if row is None:
                    row = ResolvedEntity(project_id=project_id, audience_version_id=uuid.UUID(a["id"]), query_text=text)
                    s.add(row)
                else:
                    row = await s.merge(row)
                row.status = status
                row.candidates = [{k: c.get(k) for k in ("qloo_id", "name", "type", "types", "popularity",
                                                         "disambiguation", "tags")} for c in cands]
                if chosen:
                    row.qloo_id, row.qloo_type, row.canonical_name = chosen["qloo_id"], chosen["type"], chosen["name"]
                    row.tags = chosen.get("tags") or []
            if status == "ambiguous":
                ambiguous.append({"audience_version_id": a["id"], "query": text, "candidates": len(cands)})
    return {"status": "needs_decision" if ambiguous else "ok", "ambiguous": ambiguous}


async def signals_for(project_id: uuid.UUID, audience_version_id: str | None = None) -> tuple[list[str], list[str]]:
    """Approved Qloo entity ids (resolved or explicit proxies) and tag ids."""
    async with session_scope() as s:
        q = select(ResolvedEntity).where(ResolvedEntity.project_id == project_id,
                                         ResolvedEntity.status.in_(("resolved", "proxy")))
        if audience_version_id:
            q = q.where(ResolvedEntity.audience_version_id == uuid.UUID(audience_version_id))
        rows = (await s.execute(q)).scalars().all()
    ents = sorted({r.qloo_id for r in rows if r.qloo_id and not (r.qloo_type or "").startswith("urn:tag")})
    tags = sorted({r.qloo_id for r in rows if r.qloo_id and (r.qloo_type or "").startswith("urn:tag")})
    return ents[:10], tags[:10]


# ---------------------------------------------------------------- areas ------
def _circle(lat: float, lon: float, radius_m: float):
    # Buffer in a local metric approximation (degrees scaled by latitude). The
    # geography column stores WGS 84; distances are computed geodesically.
    import math
    dlat = radius_m / 111_320.0
    dlon = radius_m / (111_320.0 * max(0.1, math.cos(math.radians(lat))))
    from shapely.geometry import Polygon
    pts = [(lon + dlon * math.cos(t), lat + dlat * math.sin(t)) for t in [i * 2 * math.pi / 48 for i in range(48)]]
    return Polygon(pts)


async def ensure_areas(project_id: uuid.UUID, constraints: dict) -> list[dict]:
    out = []
    for region in constraints["candidate_regions"]:
        lat, lon = region.get("lat"), region.get("lon")
        source, ref = region.get("source") or "owner-selected", region.get("source_ref") or {}
        if lat is None or lon is None:
            res, meta = await geo.geocode(region.get("query") or region["name"], constraints["country_code"], limit=1)
            if not res:
                out.append({"name": region["name"], "error": "could not geocode"})
                continue
            lat, lon, source = res[0]["lat"], res[0]["lon"], "OpenStreetMap Nominatim (top result; assumption)"
            ref = {"label": res[0]["label"], "osm_id": res[0]["osm_id"]}
        radius_m = float(region.get("radius_km", 5)) * 1000
        async with session_scope() as s:
            row = (await s.execute(select(GeographicArea).where(
                GeographicArea.project_id == project_id, GeographicArea.name == region["name"],
                GeographicArea.kind == "candidate"))).scalars().first()
            if row is None:
                row = GeographicArea(id=uuid.uuid4(), project_id=project_id, name=region["name"], kind="candidate")
                s.add(row)
            row.country_code = (region.get("country_code") or constraints["country_code"]).upper()
            row.center = from_shape(Point(lon, lat), srid=4326)
            row.geom = from_shape(_circle(lat, lon, radius_m), srid=4326)
            row.radius_m = Decimal(str(radius_m))
            row.source, row.source_ref = source, ref
            row.display_name = region.get("label") or ref.get("label") or region["name"]
            await s.flush()
            out.append({"area_id": str(row.id), "name": row.name, "lat": lat, "lon": lon, "radius_m": radius_m,
                        "country_code": row.country_code})
    return out


# ---------------------------------------------------------------- geography --
async def geographic_research(run_id: uuid.UUID, project_id: uuid.UUID, area: dict, product: dict) -> dict:
    """Retrieved places and historical climate for one area. Idempotent per run."""
    aid = uuid.UUID(area["area_id"])
    async with session_scope() as s:
        done = (await s.execute(select(EvidenceRecord.id).where(EvidenceRecord.run_id == run_id, EvidenceRecord.area_id == aid,
                                                               EvidenceRecord.topic == "places").limit(1))).first()
    if done:
        return {"area_id": area["area_id"], "skipped": "already researched in this run"}
    records: list[EvidenceRecord] = []
    places_rows: list[Place] = []
    summary = {"area_id": area["area_id"], "places": 0, "climate": False}
    try:
        places, meta = await geo.osm_places(area["lat"], area["lon"], int(area["radius_m"]))
        counts: dict[str, int] = {}
        for p in places:
            counts[p["category"]] = counts.get(p["category"], 0) + 1
        e_places = ev.new(project_id, kind="observed_fact", topic="places", run_id=run_id, area_id=aid,
                          title=f"{len(places)} named places retrieved within {area['radius_m'] / 1000:.0f} km of {area['name']}",
                          statement="Retrieved set by category: " + ", ".join(f"{k.replace('_', ' ')} {v}" for k, v in sorted(counts.items())),
                          source=meta["source"], source_ref=settings.PLACES_BASE_URL, value=len(places), units="places",
                          retrieved_at=meta["retrieved_at"], scope={"radius_m": meta["radius_m"], "counts": counts,
                                                                   "center": [area["lat"], area["lon"]]},
                          limitations="Counts cover only the retrieved, named OpenStreetMap features in these categories "
                                      "(capped at 400). This is not a census of businesses; mapping completeness varies.",
                          payload={"attribution": meta["attribution"], "cached": meta["cached"]})
        records.append(e_places)
        now = datetime.now(UTC)
        for p in places:
            places_rows.append(Place(
                id=uuid.uuid4(), project_id=project_id, run_id=run_id, area_id=aid, provider=p["provider"],
                provider_id=p["provider_id"], name=p["name"][:300], category=p["category"], role=p["role"],
                role_basis=p["role_basis"], provider_categories=p["provider_categories"], address=p["address"],
                geom=from_shape(Point(p["lon"], p["lat"]), srid=4326), distance_m=Decimal(str(p["distance_m"])),
                accessibility=p["accessibility"], metadata_=p["metadata"], retrieved_at=now, evidence_id=e_places.id))
        summary["places"] = len(places)
    except ProviderError as e:
        records.append(ev.new(project_id, kind="data_gap", topic="places", run_id=run_id, area_id=aid,
                              title=f"Place data unavailable for {area['name']}", statement=e.message,
                              source="osm-overpass", limitations="Partner, venue and competitor components are missing."))
    try:
        clim, meta = await geo.climate_summary(area["lat"], area["lon"])
        e_clim = ev.new(project_id, kind="observed_fact", topic="climate", run_id=run_id, area_id=aid,
                        title=f"{area['name']}: {clim['hot_days_per_year_tmax_ge_35c']} days/yr with max ≥ 35 °C",
                        statement=(f"Mean daily maximum in the hottest month: {clim['hottest_month_mean_max_c']} °C. "
                                   f"Average {clim['days_per_year_apparent_ge_40c']} days/yr with apparent maximum ≥ 40 °C."),
                        source=meta["source"], source_ref=meta["source_ref"], value=clim["hot_days_per_year_tmax_ge_35c"],
                        units="days/year", period=clim["period"], retrieved_at=meta["retrieved_at"],
                        scope={"lat": area["lat"], "lon": area["lon"], "monthly_mean_daily_max_c": clim["monthly_mean_daily_max_c"]},
                        limitations="Historical reanalysis (ERA5), grid-cell scale, 2023–2025. Not a forecast, not a station "
                                    "observation, and says nothing about demand or medical need.",
                        payload={"attribution": meta["attribution"], "kind": meta["kind"]})
        records.append(e_clim)
        summary["climate"] = True
        summary["hot_days"] = clim["hot_days_per_year_tmax_ge_35c"]
        fan = next((f for f in product.get("features", []) if f["key"] == "fan" and f["enabled"]), None)
        if fan:
            records.append(ev.new(project_id, kind="hypothesis", topic="feature_relevance", run_id=run_id, area_id=aid,
                                  title=f"Fan feature may be relevant in {area['name']}'s hot season",
                                  statement=("Frequent hot days suggest the built-in fan could be a relevant message here. "
                                             "This is a feature-relevance hypothesis to test, not proof of comfort benefit, "
                                             "medical effectiveness or buyer demand."),
                                  source="LaunchLens derived", formula="hot_days_per_year_tmax_ge_35c (rank across candidates)",
                                  inputs=[e_clim.id], value=clim["hot_days_per_year_tmax_ge_35c"], units="days/year"))
    except ProviderError as e:
        records.append(ev.new(project_id, kind="data_gap", topic="climate", run_id=run_id, area_id=aid,
                              title=f"Climate data unavailable for {area['name']}", statement=e.message, source="open-meteo"))
    # Facts that are NOT available are recorded as unknown, never as zero.
    for topic, what in (("noise", "Measured ambient noise levels"), ("footfall", "Footfall or visitor counts"),
                        ("income", "Household income or purchasing power"),
                        ("accessibility", "Verified step-free accessibility of venues"),
                        ("ad_inventory", "Advertising inventory, prices and availability")):
        records.append(ev.new(project_id, kind="data_gap", topic=topic, run_id=run_id, area_id=aid,
                              title=f"{what}: unknown in {area['name']}",
                              statement=f"No source for {what.lower()} is configured. It is treated as unknown, not zero, "
                                        "and cannot appear as a figure in strategies or ads.",
                              source="LaunchLens coverage check"))
    async with session_scope() as s:
        for r in records:
            s.add(r)
        await s.flush()
        for p in places_rows:
            s.add(p)
    return summary


# ---------------------------------------------------------------- taste ------
# Qloo place-category tags (verified with /v2/tags on 2026-10-09) -> (app category, role)
QLOO_PARTNER_TAGS: dict[str, tuple[str, str]] = {
    "urn:tag:category:place:pharmacy": ("pharmacy", "partner"),
    "urn:tag:category:place:hospital": ("hospital", "institution"),
    "urn:tag:category:place:medical_clinic": ("clinic", "institution"),
    "urn:tag:category:place:shopping_mall": ("shopping_mall", "venue"),
    "urn:tag:category:place:community_center": ("community_centre", "venue"),
    "urn:tag:category:place:senior_citizen_center": ("social_facility", "institution"),
    "urn:tag:category:place:nursing_home": ("social_facility", "institution"),
    "urn:tag:category:place:physical_therapist": ("physiotherapy", "partner"),
    "urn:tag:category:place:medical_supply_store": ("medical_supply_store", "competitor"),
    "urn:tag:category:place:mobility_equipment_supplier": ("mobility_store", "competitor"),
    "urn:tag:category:place:electronics_store": ("electronics_store", "partner"),
}
LIFT_MIN_BASELINE = 5      # baseline results an area needs before its taste share means anything
COMMON_PAGES, COMMON_TAKE = 3, 50


def _wkt_union(areas: list[dict]) -> tuple[str, dict]:
    from shapely.geometry import MultiPolygon
    polys = {a["area_id"]: _circle(a["lat"], a["lon"], float(a["radius_m"])) for a in areas}
    return MultiPolygon(list(polys.values())).wkt, polys


def _assign(results: list[dict], polys: dict) -> tuple[dict, int]:
    counts = {k: 0 for k in polys}
    outside = 0
    for r in results:
        if r.get("lat") is None or r.get("lon") is None:
            continue
        hit = next((k for k, p in polys.items() if p.contains(Point(r["lon"], r["lat"]))), None)
        if hit:
            counts[hit] += 1
        else:
            outside += 1
    return counts, outside


async def common_taste(run_id: uuid.UUID, project_id: uuid.UUID, areas: list[dict], audiences: list[dict],
                       entities: list[dict], budget: qloo.CallBudget, qloo_enabled: bool) -> dict:
    """Comparable cultural evidence across candidate areas.

    Per-city affinity means come from different query contexts and are not
    directly comparable. Instead, ONE query covers all candidate areas
    (MULTIPOLYGON): with an audience's taste signals it returns places ranked by
    affinity; without signals (baseline) it returns Qloo's general results for
    the same areas. An area's taste LIFT is its share of taste-matched results
    divided by its share of baseline results (Laplace-smoothed). Lift is
    unitless, so audiences can be combined (mean log2 lift). Areas with fewer
    than LIFT_MIN_BASELINE baseline results are 'sparse' and get no score; with
    fewer than two scorable areas there is nothing to compare, so the cultural
    component stays missing. Results are truncated ranked sets, not a census."""
    from math import log2
    good = [a for a in areas if not a.get("error")]
    out = {a["area_id"]: {"cultural_fit": None, "state": "missing", "by_audience": {}} for a in good}
    if not qloo_enabled:
        for v in out.values():
            v.update(state="disabled_by_experiment", reason="Qloo signals withheld by the experiment condition")
        return out
    if not qloo.configured():
        for v in out.values():
            v.update(state="missing", reason="Qloo is not configured")
        return out
    wkt, polys = _wkt_union(good)
    try:
        base, bmeta = await qloo.common_places(wkt, entity_ids=[], tag_ids=[], pages=COMMON_PAGES, take=COMMON_TAKE,
                                               budget=budget, context={"run_areas": sorted(polys)})
    except ProviderError as e:
        for v in out.values():
            v.update(state="unsupported" if e.kind == "unsupported" else "error", reason=e.message)
        return out
    bcounts, boutside = _assign(base, polys)
    btotal = sum(bcounts.values())
    names = {a["area_id"]: a["name"] for a in good}
    records = []
    for aud in audiences:
        ents, tags = ctxsvc.signals_from(entities, aud["id"])
        if not ents and not tags:
            for v in out.values():
                v["by_audience"][aud["id"]] = {"state": "no_signals"}
            continue
        try:
            res, smeta = await qloo.common_places(wkt, entity_ids=ents, tag_ids=tags, pages=COMMON_PAGES,
                                                  take=COMMON_TAKE, budget=budget,
                                                  context={"run_areas": sorted(polys), "audience_hash": aud["hash"]})
        except ProviderError as e:
            for v in out.values():
                v["by_audience"][aud["id"]] = {"state": "unsupported" if e.kind == "unsupported" else "error",
                                              "message": e.message}
            continue
        scounts, soutside = _assign(res, polys)
        stotal = sum(scounts.values())
        k = len(polys)
        rows = {}
        for aid in polys:
            nb, ns = bcounts[aid], scounts[aid]
            share_b = (nb + 0.5) / (btotal + 0.5 * k) if btotal else None
            share_s = (ns + 0.5) / (stotal + 0.5 * k) if stotal else None
            if not stotal:
                st, lift = "empty", None
            elif nb < LIFT_MIN_BASELINE:
                st, lift = "sparse", None
            else:
                st, lift = "available", round(share_s / share_b, 4)
            rows[aid] = {"state": st, "lift": lift, "log2_lift": round(log2(lift), 4) if lift else None,
                         "n_signal": ns, "n_baseline": nb, "share_signal": round(share_s, 4) if share_s else None,
                         "share_baseline": round(share_b, 4) if share_b else None}
        e = ev.new(project_id, kind="derived_metric", topic="taste_common", run_id=run_id,
                   audience_version_id=uuid.UUID(aud["id"]),
                   title=f"Qloo taste lift across candidate areas for {aud['name']}",
                   statement="; ".join(f"{names[aid]}: {r['n_signal']} of {stotal} taste-matched vs {r['n_baseline']} of "
                                       f"{btotal} baseline results -> " +
                                       (f"lift {r['lift']:.2f}x" if r["lift"] else r["state"]) for aid, r in rows.items()),
                   source="LaunchLens derived from Qloo Insights (one common query context)",
                   source_ref=f"{settings.QLOO_BASE_URL}/v2/insights filter.location=MULTIPOLYGON of candidate areas",
                   formula=("lift(area) = ((n_signal+0.5)/(N_signal+0.5k)) / ((n_baseline+0.5)/(N_baseline+0.5k)); "
                            f"N = results inside candidate areas from {COMMON_PAGES}x{COMMON_TAKE} ranked results; "
                            f"sparse if n_baseline < {LIFT_MIN_BASELINE}"),
                   retrieved_at=smeta.get("retrieved_at"),
                   scope={"areas": names, "signal_entities": ents, "signal_tags": tags, "pages": COMMON_PAGES,
                          "take": COMMON_TAKE, "query_hashes": smeta["query_hashes"],
                          "baseline_query_hashes": bmeta["query_hashes"], "truncated": smeta["truncated"],
                          "outside_areas": {"signal": soutside, "baseline": boutside}},
                   limitations=("A share of a truncated, ranked result set, compared with Qloo's own no-taste results "
                                "for the same areas. It shows where these tastes concentrate relative to Qloo's coverage; "
                                "it is not demand, market size or purchase likelihood."),
                   payload={"rows": rows, "n_signal_total": stotal, "n_baseline_total": btotal})
        records.append(e)
        for aid, r in rows.items():
            out[aid]["by_audience"][aud["id"]] = {**r, "evidence_id": str(e.id)}
    async with session_scope() as s:
        for r in records:
            s.add(r)
    scorable = {aid for aid, v in out.items()
                if any(x.get("state") == "available" for x in v["by_audience"].values())}
    for aid, v in out.items():
        lifts = [x["log2_lift"] for x in v["by_audience"].values() if x.get("state") == "available"]
        if len(scorable) < 2:
            v.update(state="not_comparable", reason="Fewer than two candidate areas have enough Qloo coverage to compare")
        elif lifts:
            v.update(cultural_fit=round(sum(lifts) / len(lifts), 4), state="available",
                     reason="mean log2 taste lift across audiences with signals")
        else:
            states = {x.get("state") for x in v["by_audience"].values()}
            v.update(state="sparse" if "sparse" in states else ("empty" if "empty" in states else "missing"),
                     reason="Qloo coverage here is too thin to score" if "sparse" in states else
                     "No usable taste results for this area")
    return out


async def taste_analysis(run_id: uuid.UUID, project_id: uuid.UUID, area: dict, audiences: list[dict],
                         budget: qloo.CallBudget, qloo_enabled: bool, entities: list[dict] | None = None) -> dict:
    """Venue-level Qloo recommendations WITHIN one area (explanations included).
    These rank places inside the city; they are not used to compare cities."""
    aid = uuid.UUID(area["area_id"])
    if not qloo_enabled:
        async with session_scope() as s:
            s.add(ev.new(project_id, kind="data_gap", topic="taste", run_id=run_id, area_id=aid,
                         title="Qloo signals disabled for this comparison run",
                         statement="Experiment condition: taste signals withheld; practical evidence is identical.",
                         source="LaunchLens experiment", status="unknown"))
        return {"area_id": area["area_id"], "state": "disabled_by_experiment", "by_audience": {}}
    if not qloo.configured():
        async with session_scope() as s:
            s.add(ev.new(project_id, kind="data_gap", topic="taste", run_id=run_id, area_id=aid,
                         title=f"Qloo taste signals unavailable for {area['name']}",
                         statement="Qloo is not configured, so cultural evidence is missing and the ranking is incomplete.",
                         source="qloo"))
        return {"area_id": area["area_id"], "state": "missing", "by_audience": {}}
    by_aud: dict[str, dict] = {}
    records = []
    qloo_places: dict[str, dict] = {}
    for a in audiences:
        if entities is not None:
            ents, tags = ctxsvc.signals_from(entities, a["id"])
        else:
            ents, tags = await signals_for(project_id, a["id"])
        if not ents and not tags:
            by_aud[a["id"]] = {"state": "no_signals"}
            continue
        try:
            results, meta = await qloo.places_near(area["lat"], area["lon"], int(area["radius_m"]), entity_ids=ents,
                                                   tag_ids=tags, take=20, budget=budget,
                                                   context={"audience_hash": a["hash"], "area": area["area_id"]})
        except ProviderError as e:
            by_aud[a["id"]] = {"state": "unsupported" if e.kind == "unsupported" else "error", "message": e.message}
            records.append(ev.new(project_id, kind="data_gap", topic="taste", run_id=run_id, area_id=aid,
                                  audience_version_id=uuid.UUID(a["id"]), title=f"Qloo query failed for {a['name']}",
                                  statement=e.message, source="qloo"))
            continue
        # One explicitly sorted list of finite affinities drives BOTH the summary and the displayed places.
        scored = sorted([r for r in results if r.get("affinity") is not None], key=lambda r: -r["affinity"])
        top = scored[:10]
        mean_aff = round(sum(r["affinity"] for r in top) / len(top), 4) if top else None
        state = "available" if top else ("empty" if meta.get("empty") or not results else "no_metric")
        e = ev.new(project_id, kind="provider_signal", topic="taste", run_id=run_id, area_id=aid,
                   audience_version_id=uuid.UUID(a["id"]),
                   title=f"Qloo: places in {area['name']} recommended for {a['name']}'s interests",
                   statement=("Top places by Qloo affinity: " + ", ".join(f"{r['name']} ({r['affinity']:.2f})" for r in top[:6])
                              if top else (meta.get("empty_note") or "No usable affinity values returned.")),
                   source="Qloo Insights API", source_ref=f"{settings.QLOO_BASE_URL}/v2/insights (filter.type=urn:entity:place)",
                   value=mean_aff, units=f"mean Qloo affinity of the {len(top)} shown places (this query only)",
                   retrieved_at=meta["retrieved_at"], status="supported" if top else "unknown",
                   scope={"radius_m": int(area["radius_m"]), "signal_entities": ents, "signal_tags": tags, "take": 20,
                          "returned": len(results), "with_affinity": len(scored), "query_hash": meta["query_hash"],
                          "explainability_warning": meta.get("explainability_warning")},
                   limitations=("Within-city venue ranking only: affinity is relative to this query's results and is not "
                                "compared across cities. Not demand, footfall, purchase probability or willingness to "
                                "partner, and says nothing about disability or wheelchair use."),
                   payload={"top": [{k: r.get(k) for k in ("qloo_id", "name", "affinity", "popularity", "lat", "lon",
                                                         "address", "tags", "explanation")} for r in top]},
                   redistributable=False)
        records.append(e)
        by_aud[a["id"]] = {"state": state, "mean_affinity_shown": mean_aff, "n_shown": len(top),
                           "n_returned": len(results), "evidence_id": str(e.id),
                           "places": [{k: r.get(k) for k in ("qloo_id", "name", "affinity", "lat", "lon", "explanation")}
                                      for r in top]}
        try:
            partners, pmeta = await qloo.places_near(area["lat"], area["lon"], int(area["radius_m"]), entity_ids=ents,
                                                     tag_ids=tags, filter_tags=list(QLOO_PARTNER_TAGS), take=40,
                                                     budget=budget, context={"audience_hash": a["hash"],
                                                                             "area": area["area_id"], "partners": 1})
        except ProviderError as e2:
            partners, pmeta = [], {"error": e2.message}
        kept = 0
        for r in partners:
            cat = next((QLOO_PARTNER_TAGS[t["id"]] for t in (r.get("tags") or []) if t.get("id") in QLOO_PARTNER_TAGS), None)
            if not cat or r.get("lat") is None or r.get("lon") is None or not r.get("qloo_id"):
                continue
            entry = qloo_places.setdefault(r["qloo_id"], {**r, "category": cat[0], "role": cat[1],
                                                          "affinity_by_audience": {}, "explanation_by_audience": {}})
            entry["affinity_by_audience"][a["id"]] = r.get("affinity")
            entry["explanation_by_audience"][a["id"]] = r.get("explanation")
            kept += 1
        if partners or pmeta.get("empty"):
            ranked = sorted([q for q in partners if q.get("affinity") is not None], key=lambda q: -q["affinity"])
            records.append(ev.new(project_id, kind="provider_signal", topic="taste_partners", run_id=run_id, area_id=aid,
                                  audience_version_id=uuid.UUID(a["id"]),
                                  title=f"Qloo: {kept} partner-type places in {area['name']} ranked for {a['name']}",
                                  statement=("Pharmacies, hospitals, malls, community/senior centres, physiotherapists and "
                                             "mobility/medical suppliers returned by Qloo for these taste signals: "
                                             + ", ".join(f"{q['name']} ({q['affinity']:.2f})" for q in ranked[:6]))
                                  if partners else pmeta.get("empty_note", ""),
                                  source="Qloo Insights API", source_ref=f"{settings.QLOO_BASE_URL}/v2/insights (filter.tags=place categories)",
                                  value=kept, units="places (retrieved set)", retrieved_at=pmeta.get("retrieved_at"),
                                  scope={"radius_m": int(area["radius_m"]), "filter_tags": list(QLOO_PARTNER_TAGS), "take": 40,
                                         "query_hash": pmeta.get("query_hash")},
                                  limitations="Affinity ranks taste relevance only; it does not establish willingness to "
                                              "collaborate, footfall or ad availability. Retrieved set, not a census.",
                                  redistributable=False))
    async with session_scope() as s:
        for r in records:
            s.add(r)
        await s.flush()
        now = datetime.now(UTC)
        for q in qloo_places.values():
            s.add(Place(id=uuid.uuid4(), project_id=project_id, run_id=run_id, area_id=aid, provider="qloo",
                        provider_id=q["qloo_id"], name=(q["name"] or "")[:300], category=q["category"], role=q["role"],
                        role_basis="inferred_category", provider_categories=[t.get("id") for t in (q.get("tags") or [])
                                                                             if t.get("id") in QLOO_PARTNER_TAGS],
                        address=q.get("address") or "", geom=from_shape(Point(q["lon"], q["lat"]), srid=4326),
                        distance_m=Decimal(str(round(geo.haversine_m(area["lat"], area["lon"], q["lat"], q["lon"]), 1))),
                        accessibility="unknown", qloo_entity_id=q["qloo_id"], retrieved_at=now,
                        metadata_={"qloo_affinity_by_audience": q["affinity_by_audience"],
                                   "qloo_explanation_by_audience": q["explanation_by_audience"],
                                   "qloo_popularity": q.get("popularity"), "business_rating": q.get("business_rating"),
                                   "source_note": "Qloo place entity (category tag match)"}))
    states = {v.get("state") for v in by_aud.values()}
    return {"area_id": area["area_id"], "state": "available" if "available" in states else
            (sorted(states)[0] if states else "missing"), "by_audience": by_aud}


# ---------------------------------------------------------------- evaluation -
async def evaluate(run_id: uuid.UUID, project_id: uuid.UUID, areas: list[dict], constraints: dict,
                   taste: dict[str, dict], qloo_enabled: bool, common: dict | None = None) -> list[dict]:
    from geoalchemy2.shape import to_shape
    async with session_scope() as s:
        evs = (await s.execute(select(EvidenceRecord).where(EvidenceRecord.run_id == run_id))).scalars().all()
        # Practical components count the supplementary (OSM) set only, so Qloo never changes them and the
        # with/without-Qloo experiment holds practical evidence constant.
        place_rows = (await s.execute(select(Place.area_id, Place.role).where(Place.run_id == run_id,
                                                                              Place.provider != "qloo"))).all()
    by_area: dict[str, list[EvidenceRecord]] = {}
    for e in evs:
        by_area.setdefault(str(e.area_id), []).append(e)
    role_counts: dict[str, dict[str, int]] = {}
    for aid, role in place_rows:
        role_counts.setdefault(str(aid), {}).setdefault(role, 0)
        role_counts[str(aid)][role] += 1
    service = constraints.get("service_regions") or []
    excluded = {r.get("name", "").lower() for r in constraints.get("excluded_regions") or []}
    candidates = []
    new_evidence = []
    for a in areas:
        if a.get("error"):
            continue
        aid = a["area_id"]
        es = by_area.get(aid, [])
        c = scoring.Candidate(area_id=aid, name=a["name"], country_code=a["country_code"], lat=a["lat"], lon=a["lon"])
        # hard: country
        c.hard.append({"name": "Country", "result": "pass" if a["country_code"] == constraints["country_code"] else "fail",
                       "reason": f"{a['name']} is outside {constraints['country_code']}" if a["country_code"] != constraints["country_code"] else "In launch country"})
        # hard: excluded list
        if a["name"].lower() in excluded:
            c.hard.append({"name": "Owner exclusion", "result": "fail", "reason": f"{a['name']} was excluded by the owner"})
        # hard: service coverage (geodesic distance to each service region centre)
        if service:
            hits = [r for r in service if geo.haversine_m(a["lat"], a["lon"], r["lat"], r["lon"]) <= float(r.get("radius_km", 50)) * 1000]
            nearest = min(service, key=lambda r: geo.haversine_m(a["lat"], a["lon"], r["lat"], r["lon"]))
            dist_km = geo.haversine_m(a["lat"], a["lon"], nearest["lat"], nearest["lon"]) / 1000
            e_svc = ev.new(project_id, kind="derived_metric", topic="service", run_id=run_id, area_id=uuid.UUID(aid),
                           title=f"{a['name']}: {'inside' if hits else 'outside'} service coverage",
                           statement=f"Nearest service region '{nearest['name']}' centre is {dist_km:.1f} km away "
                                     f"(coverage radius {nearest.get('radius_km', 50)} km, owner-provided).",
                           source="LaunchLens geodesic distance", value=round(dist_km, 2), units="km",
                           formula="haversine(area centre, service region centre) <= radius_km",
                           limitations="Service regions are owner-provided circles; real coverage boundaries may differ.")
            new_evidence.append(e_svc)
            c.hard.append({"name": "Service coverage", "result": "pass" if hits else "fail",
                           "reason": ("Inside " + hits[0]["name"]) if hits else f"Outside every service region (nearest {dist_km:.0f} km)",
                           "evidence_ids": [str(e_svc.id)]})
            c.topics_present.add("service")
        else:
            c.hard.append({"name": "Service coverage", "result": "unknown", "reason": "Owner has not set service regions (assumed serviceable)"})
        # hard: budget feasibility where known
        ad, minimum = constraints.get("ad_spend_budget"), constraints.get("min_ad_spend_per_location")
        if ad is not None and minimum is not None:
            ok = ad >= minimum
            c.hard.append({"name": "Budget feasibility", "result": "pass" if ok else "fail",
                           "reason": f"Ad budget {ad:,.0f} {'≥' if ok else '<'} minimum per location {minimum:,.0f} {constraints['currency']}"})
            c.topics_present.add("budget")
        elif ad is not None:
            c.topics_present.add("budget")
            c.hard.append({"name": "Budget feasibility", "result": "unknown", "reason": "No minimum spend per location set"})
        # hard: distribution requirement (needs a partner-type place)
        rc = role_counts.get(aid, {})
        has_places = any(e.topic == "places" and e.kind == "observed_fact" for e in es)
        for req in constraints.get("distribution_requirements") or []:
            if req == "partner_outlet_in_area":
                if not has_places:
                    c.hard.append({"name": "Partner outlet available", "result": "unknown", "reason": "Place data missing"})
                else:
                    n = rc.get("partner", 0) + rc.get("competitor", 0)
                    c.hard.append({"name": "Partner outlet available", "result": "pass" if n else "fail",
                                   "reason": f"{n} potential retail partners in the retrieved set" if n else "No potential retail partner retrieved"})
        # components (raw values; normalised in scoring)
        e_places = next((e for e in es if e.topic == "places" and e.kind == "observed_fact"), None)
        e_clim = next((e for e in es if e.topic == "climate" and e.kind == "observed_fact"), None)
        if e_places:
            c.topics_present.add("places")
            c.raw["partner_access"] = rc.get("partner", 0) + rc.get("institution", 0)
            c.raw["venue_access"] = rc.get("venue", 0)
            c.raw["competitive_room"] = rc.get("competitor", 0)
            for k in ("partner_access", "venue_access", "competitive_room"):
                c.raw_meta[k] = {"units": "places in retrieved set", "evidence_ids": [str(e_places.id)]}
        if e_clim:
            c.topics_present.add("climate")
            c.raw["feature_relevance"] = float(e_clim.value_numeric)
            c.raw_meta["feature_relevance"] = {"units": "hot days/year (hypothesis input)", "evidence_ids": [str(e_clim.id)]}
        cm = (common or {}).get(aid) or {}
        by_a = cm.get("by_audience") or {}
        c.raw_meta["cultural_fit"] = {
            "units": "mean log2 taste lift (one common Qloo query across candidate areas)",
            "method": "share of taste-matched results / share of no-taste baseline results, same query context",
            "evidence_ids": sorted({v["evidence_id"] for v in by_a.values() if v.get("evidence_id")}),
            "by_audience": {k: {kk: v.get(kk) for kk in ("state", "lift", "n_signal", "n_baseline")} for k, v in by_a.items()},
            "cultural_state": cm.get("state", "missing"), "missing_reason": cm.get("reason")}
        if cm.get("cultural_fit") is not None:
            c.topics_present.add("taste")
            c.raw["cultural_fit"] = cm["cultural_fit"]
        candidates.append(c)
    weights = {**scoring.DEFAULT_WEIGHTS, **(constraints.get("weights") or {})}
    results = scoring.score(candidates, weights, qloo_enabled=qloo_enabled)
    async with session_scope() as s:
        for e in new_evidence:
            s.add(e)
        await s.flush()
        await s.execute(delete(LocationAssessment).where(LocationAssessment.run_id == run_id))
        for r in results:
            ev_ids = sorted({i for h in r["hard_constraints"] for i in h.get("evidence_ids", [])} |
                            {i for comp in r["components"].values() for i in comp.get("evidence_ids", [])})
            assumptions = [h["reason"] for h in r["hard_constraints"] if h["result"] == "unknown"]
            limitations = ["Indices are application planning indices (rank-based, 0–1), not forecasts.",
                           "Evidence coverage is a completeness share, not a statistical confidence."]
            if r["status"] == "incomplete":
                missing = [c["label"] for c in r["components"].values() if c["state"] != "available"]
                limitations.append(f"Incomplete: {', '.join(missing)} unavailable; index shows {r['available_weight']:.0%} of total weight and is not comparable with complete results.")
            s.add(LocationAssessment(
                project_id=project_id, run_id=run_id, area_id=uuid.UUID(r["area_id"]), eligible=r["eligible"],
                status=r["status"], hard_constraints=r["hard_constraints"], components=r["components"],
                weights=r["weights"], practical_index=_d(r["practical_index"]), cultural_index=_d(r["cultural_index"]),
                planning_index=_d(r["planning_index"]), available_weight=_d(r["available_weight"]) or Decimal(0),
                evidence_coverage=_d(r["evidence_coverage"]) or Decimal(0), rank=r["rank"],
                assumptions=assumptions, limitations=limitations, evidence_ids=ev_ids,
                input_hash=_assessment_hash(r)))
    _ = to_shape
    return results


def _d(v):
    return Decimal(str(v)) if v is not None else None


def _assessment_hash(r: dict) -> str:
    from .cache import stable_hash
    return stable_hash({"hard": [(h["name"], h["result"]) for h in r["hard_constraints"]],
                        "comp": {k: v.get("raw") for k, v in r["components"].items()}, "status": r["status"]})


# ---------------------------------------------------------------- placements -
ROLE_FIT = {
    "product_user": {"community_centre": 1.0, "shopping_mall": 0.9, "physiotherapy": 0.9, "pharmacy": 0.7,
                     "social_facility": 0.6, "medical_supply_store": 0.6, "hospital": 0.4, "clinic": 0.4},
    "purchaser": {"pharmacy": 1.0, "shopping_mall": 0.9, "community_centre": 0.8, "medical_supply_store": 0.8,
                  "physiotherapy": 0.7, "electronics_store": 0.5, "hospital": 0.4, "clinic": 0.4},
    "institutional_buyer": {"hospital": 1.0, "clinic": 0.9, "social_facility": 1.0, "physiotherapy": 0.7},
    "distribution_partner": {"medical_supply_store": 1.0, "mobility_store": 1.0, "pharmacy": 0.8,
                             "electronics_store": 0.6},
}
ACTIVATION = {
    "community_centre": ("physical_venue", "demonstration"), "shopping_mall": ("physical_venue", "demonstration"),
    "physiotherapy": ("partner_business", "partnership_flyer"), "pharmacy": ("partner_business", "counter_display"),
    "medical_supply_store": ("retail_distributor", "counter_display"), "mobility_store": ("retail_distributor", "counter_display"),
    "electronics_store": ("retail_distributor", "counter_display"), "hospital": ("partner_business", "demonstration"),
    "clinic": ("partner_business", "partnership_flyer"), "social_facility": ("partner_business", "demonstration"),
}
NEXT_ACTION = {
    "physical_venue": "Contact the venue manager to ask whether product demonstrations are permitted, on which dates, and at what cost.",
    "partner_business": "Visit or call to ask whether they accept partner flyers or a demo session; confirm decision-maker and terms.",
    "retail_distributor": "Ask whether they stock mobility products from new brands and on what margin/terms.",
    "digital_geo": "Confirm the ad platform's geo-targeting options and minimum spend for this area before committing budget.",
}


def _name_key(n: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (n or "").lower())


async def placement_research(run_id: uuid.UUID, project_id: uuid.UUID, area: dict, audiences: list[dict],
                             taste: dict) -> int:
    aid = uuid.UUID(area["area_id"])
    async with session_scope() as s:
        if (await s.execute(select(PlacementCandidate.id).where(PlacementCandidate.run_id == run_id,
                                                               PlacementCandidate.area_id == aid).limit(1))).first():
            return 0
        places = (await s.execute(select(Place).where(Place.run_id == run_id, Place.area_id == aid))).scalars().all()
        place_ev = (await s.execute(select(EvidenceRecord.id).where(EvidenceRecord.run_id == run_id, EvidenceRecord.area_id == aid,
                                                                   EvidenceRecord.topic == "places"))).scalars().first()
    from geoalchemy2.shape import to_shape
    created = 0
    async with session_scope() as s:
        for a in audiences:
            fit = ROLE_FIT.get(a["role"], ROLE_FIT["purchaser"])
            qplaces = ((taste.get(area["area_id"]) or {}).get("by_audience") or {}).get(a["id"], {}).get("places") or []
            qindex = {_name_key(q["name"]): q for q in qplaces}
            scored = []
            max_d = max([float(p.distance_m or 0) for p in places] or [1.0]) or 1.0
            qloo_keys = {_name_key(p.name) for p in places if p.provider == "qloo"}
            for p in places:
                f = fit.get(p.category)
                if not f:
                    continue
                if p.provider != "qloo" and _name_key(p.name) in qloo_keys:
                    continue  # same venue also returned by Qloo: keep the Qloo record (it carries affinity)
                prox = 1 - float(p.distance_m or 0) / max_d
                q = qindex.get(_name_key(p.name))
                aff = ((p.metadata_ or {}).get("qloo_affinity_by_audience") or {}).get(a["id"]) if p.provider == "qloo" else None
                if aff is not None:
                    q = {"affinity": aff, "qloo_id": p.qloo_entity_id, "name": p.name,
                         "explanation": ((p.metadata_ or {}).get("qloo_explanation_by_audience") or {}).get(a["id"])}
                parts = {"category_fit": f, "proximity": round(prox, 3)}
                if q and q.get("affinity") is not None:
                    parts["qloo_affinity"] = q["affinity"]
                scored.append([0.0, p, parts, q])
            # Suitability = 0.45 category fit + 0.25 proximity + 0.30 Qloo affinity (rank-normalised among this
            # audience's candidates here). No affinity -> that 0.30 is simply absent (never redistributed),
            # so taste relevance genuinely changes the shortlist when Qloo signals exist.
            aff_rank = scoring.rank_transform({str(i): (x[2].get("qloo_affinity")) for i, x in enumerate(scored)})
            for i, x in enumerate(scored):
                ar = aff_rank.get(str(i))
                x[2]["affinity_rank"] = ar
                x[0] = 0.45 * x[2]["category_fit"] + 0.25 * x[2]["proximity"] + (0.30 * ar if ar is not None else 0.0)
            scored.sort(key=lambda x: -x[0])
            for score_val, p, parts, q in scored[:8]:
                channel, activation = ACTIVATION.get(p.category, ("partner_business", "partnership_flyer"))
                pt = to_shape(p.geom)
                s.add(PlacementCandidate(
                    project_id=project_id, run_id=run_id, area_id=aid, place_id=p.id, audience_version_id=uuid.UUID(a["id"]),
                    channel_type=channel, name=p.name, category=p.category, address=p.address,
                    geom=from_shape(Point(pt.x, pt.y), srid=4326), source=p.provider,
                    relationship_note=(f"{p.category.replace('_', ' ').title()} {float(p.distance_m or 0) / 1000:.1f} km from the area centre; "
                                       f"category fit for {a['role'].replace('_', ' ')} audiences."
                                       + (f" Qloo affinity to this audience's interests: {q['affinity']:.2f}." if q and q.get("affinity") is not None else "")),
                    qloo_relevance=({"affinity": q.get("affinity"), "qloo_id": q.get("qloo_id"),
                                     "affinity_rank_in_candidates": parts.get("affinity_rank"),
                                     "explanation": q.get("explanation"),
                                     "meaning": "Qloo affinity to audience interests; not willingness to collaborate"} if q else
                                    {"state": "not_available"}),
                    practical_evidence_ids=[str(place_ev)] if place_ev else [], activation=activation,
                    accessibility="unknown" if not p.accessibility.startswith("osm_reported") else p.accessibility,
                    verification={k: "unknown" for k in ("availability", "permission", "contact", "cost", "dates")},
                    status="availability_unknown", next_action=NEXT_ACTION[channel],
                    evidence_needed="Written confirmation of permission, dates, cost and contact person.",
                    suitability_score=Decimal(str(round(score_val, 4)))))
                created += 1
            s.add(PlacementCandidate(
                project_id=project_id, run_id=run_id, area_id=aid, audience_version_id=uuid.UUID(a["id"]),
                channel_type="digital_geo", name=f"Geo-targeted social campaign — {area['name']} ({area['radius_m'] / 1000:.0f} km)",
                category="digital", source="LaunchLens planning", activation="digital_campaign",
                relationship_note=f"Broad digital reach in {area['name']} for {a['name']}; targeting must not use health or disability attributes.",
                qloo_relevance={"state": "not_applicable"}, accessibility="not_applicable",
                verification={k: "unknown" for k in ("availability", "permission", "contact", "cost", "dates")},
                status="candidate", next_action=NEXT_ACTION["digital_geo"],
                evidence_needed="Platform reach estimate and minimum spend for the chosen radius.",
                suitability_score=Decimal("0.5")))
            created += 1
    return created


async def run_parallel(items, fn, limit: int):
    sem = asyncio.Semaphore(limit)

    async def one(x):
        async with sem:
            return await fn(x)
    return await asyncio.gather(*(one(x) for x in items), return_exceptions=True)


async def set_run(run_id: uuid.UUID, **values) -> None:
    async with session_scope() as s:
        run = await s.get(ResearchRun, run_id, with_for_update=True)
        if run is None:
            return
        if "stage_status" in values:
            stage, status = values.pop("stage_status")
            run.stage_statuses = {**(run.stage_statuses or {}), stage: {"status": status, "at": datetime.now(UTC).isoformat()}}
            run.stage = stage
        if "counts" in values:
            run.counts = {**(run.counts or {}), **values.pop("counts")}
        if "error" in values:
            run.errors = [*(run.errors or []), values.pop("error")]
        for k, v in values.items():
            setattr(run, k, v)
