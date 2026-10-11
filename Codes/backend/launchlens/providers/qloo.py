"""Qloo Taste AI adapter (hackathon environment by default).

Endpoints used, per https://github.com/qloo/docs-public and the Qloo hackathon
developer guide, verified live with the hackathon key on 2026-10-09:
  GET {base}/search         entity resolution by name (query, types, take, page)
  GET {base}/v2/tags        tag lookup (filter.query, filter.tag.types, take, page)
  GET {base}/v2/insights    filter.type=urn:entity:place with filter.location (WKT
                            POINT/POLYGON/MULTIPOLYGON, lon lat) [+ filter.location.radius
                            in metres], signal.interests.entities / signal.interests.tags,
                            filter.tags, take, page, feature.explainability=true;
                            filter.type=urn:heatmap for locality heatmaps (optional capability).
Auth: X-Api-Key header. Hackathon keys only work against hackathon.api.qloo.com.

Provider meaning is preserved verbatim: `affinity` is Qloo's relative
affinity for the given signals *within that query's result set*; `popularity`
is Qloo's popularity percentile; `explainability` lists which signal inputs
contributed to a result. None of these is demand, footfall, purchase
probability or a census. Raw responses are cached server-side and never
exported (not redistributable by default).
"""
from __future__ import annotations

import asyncio
import logging
import math
from datetime import UTC, datetime
from typing import Any

from ..config import settings
from ..services import cache
from .base import ProviderError, request

log = logging.getLogger("launchlens.qloo")
PROVIDER = "qloo"
API_VERSION = "v2"
# filter.type values the hackathon guide lists as supported (plus urn:heatmap, verified live).
INSIGHT_TYPES = ("urn:entity:artist", "urn:entity:book", "urn:entity:brand", "urn:entity:destination",
                 "urn:entity:movie", "urn:entity:person", "urn:entity:place", "urn:entity:podcast",
                 "urn:entity:tv_show", "urn:entity:video_game")
LOCATION_TYPES = ("urn:entity:place", "urn:entity:destination")  # types where location filters apply
TASTE_SIGNAL_EXCLUDED = ("urn:entity:locality", "urn:entity:destination", "urn:entity:place")


def configured() -> bool:
    return bool(settings.QLOO_API_KEY)


class CallBudget:
    """Caps research calls per run (MAX_RESEARCH_CALLS). Counts logical requests
    (what the cap limits) and physical attempts (including retries) separately."""

    def __init__(self, limit: int | None = None):
        self.limit = limit or settings.MAX_RESEARCH_CALLS
        self.used = 0
        self.cache_hits = 0
        self.coalesced = 0
        self.stats: dict = {"physical_attempts": 0}

    def take(self) -> None:
        if self.used >= self.limit:
            raise ProviderError(PROVIDER, "failed", f"research call budget of {self.limit} exhausted for this run")
        self.used += 1

    def summary(self) -> dict:
        return {"logical_requests": self.used, "physical_attempts": self.stats.get("physical_attempts", 0),
                "cache_hits": self.cache_hits, "coalesced": self.coalesced, "limit": self.limit}


def _headers() -> dict:
    return {"X-Api-Key": settings.QLOO_API_KEY, "accept": "application/json"}


_inflight: dict[str, asyncio.Future] = {}


async def _get(path: str, params: dict, *, budget: CallBudget | None, context: dict | None = None,
               ttl: int | None = None) -> tuple[dict, dict]:
    """GET with caching and in-flight de-duplication. Returns (json, meta)."""
    if not configured():
        raise ProviderError(PROVIDER, "not_configured", "QLOO_API_KEY is not set in .env")
    clean = {k: v for k, v in params.items() if v not in (None, "", [])}
    qh = cache.query_hash(PROVIDER, path, clean, context, API_VERSION + "|" + settings.QLOO_BASE_URL)
    hit = await cache.get(PROVIDER, qh)
    if hit is not None:
        if budget:
            budget.cache_hits += 1
        return hit.response, {"cached": True, "retrieved_at": hit.retrieved_at.isoformat(), "query_hash": qh,
                              "endpoint": path, "params": clean, "warnings": (hit.response or {}).get("warnings")}
    if qh in _inflight:  # an identical query is already on the wire: share its result
        if budget:
            budget.coalesced += 1
        return await asyncio.shield(_inflight[qh])
    fut: asyncio.Future = asyncio.get_running_loop().create_future()
    _inflight[qh] = fut
    try:
        result = await _fetch(path, clean, qh, budget, ttl)
        fut.set_result(result)
        return result
    except BaseException as e:
        fut.set_exception(e)
        fut.exception()  # mark retrieved so an unawaited future does not warn
        raise
    finally:
        _inflight.pop(qh, None)


async def _fetch(path: str, clean: dict, qh: str, budget: CallBudget | None, ttl: int | None) -> tuple[dict, dict]:
    if budget:
        budget.take()
    url = settings.QLOO_BASE_URL.rstrip("/") + path
    try:
        resp = await request(PROVIDER, "GET", url, headers=_headers(), params=clean,
                             timeout=settings.QLOO_REQUEST_TIMEOUT_SECONDS, attempts=3,
                             stats=budget.stats if budget else None)
    except ProviderError as e:
        if e.kind == "not_found":  # Qloo answers 404 for "no results"
            empty: dict[str, Any] = {"success": True, "results": {}, "_no_results": True}
            await cache.put(PROVIDER, path, qh, clean, empty, 3600, version=API_VERSION, status_code=404)
            return empty, {"cached": False, "retrieved_at": datetime.now(UTC).isoformat(), "query_hash": qh,
                           "endpoint": path, "params": clean, "no_results": True}
        raise
    data = resp.json()
    await cache.put(PROVIDER, path, qh, clean, data, ttl or settings.QLOO_CACHE_TTL_SECONDS, version=API_VERSION)
    return data, {"cached": False, "retrieved_at": datetime.now(UTC).isoformat(), "query_hash": qh,
                  "endpoint": path, "params": clean, "warnings": data.get("warnings")}


def finite(v) -> float | None:
    """Provider metrics are kept only when they are real finite numbers."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _explanation(q: dict) -> dict:
    """Normalise `query.explainability` into contributions per input. Missing
    stays missing: nothing is synthesised when Qloo does not attribute."""
    raw = q.get("explainability")
    if not isinstance(raw, dict) or not raw:
        return {"status": "not_provided", "contributions": []}
    contribs = []
    for signal, items in raw.items():
        for it in items or []:
            if not isinstance(it, dict):
                continue
            ident = it.get("entity_id") or it.get("tag_id") or it.get("id")
            score = finite(it.get("score"))
            if ident:
                contribs.append({"signal": signal, "id": ident, "score": score})
    return {"status": "provided" if contribs else "not_provided", "contributions": contribs}


def _entity(e: dict) -> dict:
    """Normalize a Qloo entity, keeping provider fields and meaning."""
    props = e.get("properties") or {}
    loc = e.get("location") or props.get("location") or {}
    q = e.get("query") or {}
    return {
        "qloo_id": e.get("entity_id") or e.get("id"),
        "name": e.get("name"),
        "type": e.get("subtype") or (e.get("types") or [None])[0] or e.get("type"),
        "types": e.get("types") or ([e.get("subtype")] if e.get("subtype") else []),
        "popularity": finite(e.get("popularity")),
        "affinity": finite(q.get("affinity")),
        "affinity_rank": finite(q.get("affinity_rank")),
        "distance_m": finite(q.get("distance")),
        "measurements": q.get("measurements"),
        "explanation": _explanation(q),
        "disambiguation": e.get("disambiguation") or props.get("short_description") or "",
        "address": props.get("address") or "",
        "geocode": props.get("geocode") or {},
        "lat": finite(loc.get("lat")),
        "lon": finite(loc.get("lon") if loc.get("lon") is not None else loc.get("lng")),
        "business_rating": finite(props.get("business_rating")),
        "tags": [{"id": t.get("id") or t.get("tag_id"), "name": t.get("name"), "type": t.get("type")}
                 for t in (e.get("tags") or [])][:25],
        "external": list((e.get("external") or {}).keys()),
    }


async def search(query: str, types: list[str] | None = None, take: int = 8,
                 budget: CallBudget | None = None) -> tuple[list[dict], dict]:
    params: dict[str, Any] = {"query": query, "take": take}
    if types:
        params["types"] = ",".join(types)
    data, meta = await _get("/search", params, budget=budget)
    results = data.get("results") or []
    if isinstance(results, dict):
        results = results.get("entities") or []
    return [_entity(e) for e in results if (e.get("entity_id") or e.get("id"))], meta


async def tags(query: str, take: int = 10, tag_types: list[str] | None = None,
               budget: CallBudget | None = None) -> tuple[list[dict], dict]:
    params: dict[str, Any] = {"filter.query": query, "take": take}
    if tag_types:
        params["filter.tag.types"] = ",".join(tag_types)
    data, meta = await _get("/v2/tags", params, budget=budget)
    res = data.get("results") or {}
    raw = res.get("tags") if isinstance(res, dict) else res
    out = [{"qloo_id": t.get("id") or t.get("tag_id"), "name": t.get("name"), "type": t.get("type") or "tag",
            "parents": t.get("parents")} for t in (raw or []) if (t.get("id") or t.get("tag_id"))]
    return out, meta


def _signals(entity_ids: list[str], tag_ids: list[str]) -> dict:
    p: dict[str, Any] = {}
    if entity_ids:
        p["signal.interests.entities"] = ",".join(entity_ids)
    if tag_ids:
        p["signal.interests.tags"] = ",".join(tag_ids)
    return p


def _empty_note(meta: dict, ents: list) -> None:
    if not ents:
        # Qloo silently ignores parameters that are invalid for a filter.type and
        # returns 200 with no entities, so "empty" is not evidence of zero.
        meta["empty"] = True
        meta["empty_note"] = ("Qloo returned no entities: either no data for this signal/location, or a parameter was "
                              "ignored as invalid for this filter.type. Treated as unknown, not zero.")


def _check_type(entity_type: str, with_location: bool) -> None:
    if entity_type not in INSIGHT_TYPES:
        raise ProviderError(PROVIDER, "unsupported", f"{entity_type} is not a supported filter.type for this key")
    if with_location and entity_type not in LOCATION_TYPES:
        raise ProviderError(PROVIDER, "unsupported", f"location filters do not apply to {entity_type}")


async def places_near(lat: float, lon: float, radius_m: int, *, entity_ids: list[str], tag_ids: list[str],
                      filter_tags: list[str] | None = None, take: int = 30, page: int = 1, explain: bool = True,
                      budget: CallBudget | None = None, context: dict | None = None) -> tuple[list[dict], dict]:
    """Places near a point, ranked by affinity to the supplied signals."""
    params: dict[str, Any] = {
        "filter.type": "urn:entity:place",
        "filter.location": f"POINT({lon:.6f} {lat:.6f})",
        "filter.location.radius": int(radius_m),
        "take": take, "page": page, **_signals(entity_ids, tag_ids)}
    if filter_tags:
        params["filter.tags"] = ",".join(filter_tags)
    if explain and (entity_ids or tag_ids):
        params["feature.explainability"] = "true"
    data, meta = await _get("/v2/insights", params, budget=budget, context=context)
    ents = ((data.get("results") or {}).get("entities")) or []
    _empty_note(meta, ents)
    out = [_entity(e) for e in ents if (e.get("entity_id") or e.get("id"))]
    could_not = any("explainability" in str((w or {}).get("type", w)).lower() for w in (meta.get("warnings") or []))
    for e in out:
        if not explain or not (entity_ids or tag_ids):
            e["explanation"]["status"] = "not_requested"
        elif e["explanation"]["status"] != "provided":
            # Verified 2026-10-09: Qloo attributes entity signals only; tag-only queries warn
            # "Could not calculate explainability". Never synthesise contributions.
            e["explanation"]["status"] = "provider_could_not_compute" if could_not else "not_provided"
    meta["explainability_warning"] = could_not
    return out, meta


async def common_places(wkt: str, *, entity_ids: list[str], tag_ids: list[str], pages: int = 3, take: int = 50,
                        budget: CallBudget | None = None, context: dict | None = None) -> tuple[list[dict], dict]:
    """ONE query context across all candidate areas (WKT MULTIPOLYGON), paged.
    With signals: places ranked by affinity to the audience's tastes. Without
    signals: the density baseline (what Qloo returns for the same areas with no
    taste input), used to normalise city shares. Results are a truncated,
    ranked set, never a census."""
    out: list[dict] = []
    metas = []
    for page in range(1, pages + 1):
        params: dict[str, Any] = {"filter.type": "urn:entity:place", "filter.location": wkt, "take": take,
                                  "page": page, **_signals(entity_ids, tag_ids)}
        data, meta = await _get("/v2/insights", params, budget=budget, context=context)
        ents = ((data.get("results") or {}).get("entities")) or []
        out += [_entity(e) for e in ents if (e.get("entity_id") or e.get("id"))]
        metas.append({k: meta.get(k) for k in ("cached", "retrieved_at", "query_hash", "warnings")})
        if len(ents) < take:
            break
    seen, uniq = set(), []
    for e in out:  # pages can overlap if the ranking shifts between calls
        if e["qloo_id"] not in seen:
            seen.add(e["qloo_id"])
            uniq.append(e)
    meta = {"pages": metas, "requested_pages": pages, "take": take, "returned": len(uniq),
            "truncated": len(uniq) >= pages * take, "retrieved_at": metas[0]["retrieved_at"] if metas else None,
            "query_hashes": [m["query_hash"] for m in metas]}
    _empty_note(meta, uniq)
    return uniq, meta


async def insights_in_location(entity_type: str, location_query: str, *, entity_ids: list[str], tag_ids: list[str],
                               take: int = 15, budget: CallBudget | None = None) -> tuple[list[dict], dict]:
    """Entities of one type with affinity to the signals, filtered to a locality.
    Only place/destination types accept a location filter."""
    _check_type(entity_type, with_location=True)
    params = {"filter.type": entity_type, "filter.location.query": location_query, "take": take,
              **_signals(entity_ids, tag_ids)}
    data, meta = await _get("/v2/insights", params, budget=budget)
    ents = ((data.get("results") or {}).get("entities")) or []
    meta["locality"] = ((data.get("query") or {}).get("localities") or {}).get("filter")
    _empty_note(meta, ents)
    return [_entity(e) for e in ents], meta


async def related(entity_type: str, *, entity_ids: list[str], tag_ids: list[str], take: int = 8,
                  budget: CallBudget | None = None) -> tuple[list[dict], dict]:
    """Entities of one type ranked by affinity to the signals, with no location
    filter (e.g. brands or TV shows that fans of an artist also like)."""
    _check_type(entity_type, with_location=False)
    params = {"filter.type": entity_type, "take": take, **_signals(entity_ids, tag_ids)}
    data, meta = await _get("/v2/insights", params, budget=budget)
    ents = ((data.get("results") or {}).get("entities")) or []
    _empty_note(meta, ents)
    return [_entity(e) for e in ents], meta


async def heatmap(*, location_query: str | None = None, wkt: str | None = None, entity_ids: list[str],
                  tag_ids: list[str], budget: CallBudget | None = None) -> tuple[list[dict], dict]:
    """Locality heatmap: grid points with affinity, affinity_rank (rank-normalized
    within THIS result set) and popularity, for the given signal only. Optional
    capability: a key without it gets 403, raised as kind='unsupported'."""
    params: dict[str, Any] = {"filter.type": "urn:heatmap", **_signals(entity_ids, tag_ids)}
    if wkt:
        params["filter.location"] = wkt
    else:
        params["filter.location.query"] = location_query
    data, meta = await _get("/v2/insights", params, budget=budget)
    pts = ((data.get("results") or {}).get("heatmap")) or []
    out = []
    for p in pts:
        loc = p.get("location") or {}
        lat, lon = finite(loc.get("latitude")), finite(loc.get("longitude"))
        if lat is None or lon is None:
            continue
        q = {k: (finite(v) if not isinstance(v, (dict, list)) else v) for k, v in (p.get("query") or {}).items()}
        out.append({"lat": lat, "lon": lon, "geohash": loc.get("geohash"), **q})
    meta["locality"] = ((data.get("query") or {}).get("localities") or {}).get("filter")
    _empty_note(meta, out)
    return out, meta


_KOLKATA = "POINT(88.3639 22.5726)"


async def probe() -> dict:
    """Readiness per operation. A 200 is not enough: each check requires usable
    data (IDs, finite metrics, capability-specific fields)."""
    out: dict = {"configured": configured(), "reachable": None, "authorized": None, "operations": {},
                 "checked_at": datetime.now(UTC).isoformat()}
    if not configured():
        out["message"] = "Qloo is not configured, so taste signals are unavailable and rankings stay incomplete."
        return out
    try:
        res, _ = await search("Starbucks", ["urn:entity:brand"], take=1)
        out.update(reachable=True, authorized=True)
        out["operations"]["search"] = "supported" if res and res[0].get("qloo_id") else "no_usable_data"
    except ProviderError as e:
        out["reachable"] = e.kind not in ("transient",)
        out["authorized"] = e.kind != "auth"
        out["operations"]["search"] = e.kind
        out["message"] = e.message
        return out

    async def check(name: str, coro, usable) -> None:
        try:
            got = await coro
            out["operations"][name] = "supported" if usable(got) else "no_usable_data"
        except ProviderError as e:
            out["operations"][name] = e.kind

    tag = "urn:tag:genre:media:cricket"
    ent = [res[0]["qloo_id"]] if res and res[0].get("qloo_id") else []  # explainability/heatmap need an entity signal
    await check("tags", tags("cricket", take=1), lambda r: bool(r[0]))
    await check("insights_place_location",
                places_near(22.5726, 88.3639, 3000, entity_ids=[], tag_ids=[tag], take=3, explain=False),
                lambda r: any(e.get("qloo_id") and e.get("affinity") is not None for e in r[0]))
    await check("explainability",
                places_near(22.5726, 88.3639, 3000, entity_ids=ent, tag_ids=[], take=3, explain=True),
                lambda r: any(e["explanation"]["status"] == "provided" for e in r[0]))
    await check("common_query_multipolygon",
                common_places("MULTIPOLYGON(((88.33 22.55, 88.40 22.55, 88.40 22.60, 88.33 22.60, 88.33 22.55)))",
                              entity_ids=[], tag_ids=[tag], pages=1, take=5),
                lambda r: bool(r[0]))
    await check("heatmap", heatmap(wkt=_KOLKATA, entity_ids=ent, tag_ids=[]),
                lambda r: bool(r[0]))
    return out
