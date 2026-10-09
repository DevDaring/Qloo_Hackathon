"""Qloo Taste AI adapter (hackathon environment by default).

Endpoints used, per https://github.com/qloo/docs-public (read 2026-10-08) and
the Qloo hackathon developer guide:
  GET {base}/search                 entity resolution by name (query, types, take, page)
  GET {base}/v2/tags                tag lookup (filter.query, filter.tag.types, take, page)
  GET {base}/v2/insights            recommendations/insights; filter.type=urn:entity:place with
                                    filter.location (WKT POINT lon lat) + filter.location.radius (m)
                                    and signal.interests.entities / signal.interests.tags;
                                    filter.type=urn:heatmap for locality heatmaps.
Auth: X-Api-Key header. Hackathon keys only work against hackathon.api.qloo.com.

Provider meaning is preserved verbatim: `affinity` is Qloo's relative
affinity for the given signals in that query context; `popularity` is Qloo's
popularity percentile. Neither is demand, footfall, purchase probability or
a census. Raw responses are cached server-side and never exported (not
redistributable by default).
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from ..config import settings
from ..services import cache
from .base import ProviderError, request

log = logging.getLogger("launchlens.qloo")
PROVIDER = "qloo"
API_VERSION = "v2"
ENTITY_TYPES = ("urn:entity:brand", "urn:entity:artist", "urn:entity:place", "urn:entity:movie",
                "urn:entity:tv_show", "urn:entity:podcast", "urn:entity:book", "urn:entity:person",
                "urn:entity:destination", "urn:entity:videogame", "urn:entity:locality")


def configured() -> bool:
    return bool(settings.QLOO_API_KEY)


class CallBudget:
    """Caps research calls per run (MAX_RESEARCH_CALLS)."""

    def __init__(self, limit: int | None = None):
        self.limit = limit or settings.MAX_RESEARCH_CALLS
        self.used = 0
        self.cache_hits = 0

    def take(self) -> None:
        if self.used >= self.limit:
            raise ProviderError(PROVIDER, "failed", f"research call budget of {self.limit} exhausted for this run")
        self.used += 1


def _headers() -> dict:
    return {"X-Api-Key": settings.QLOO_API_KEY, "accept": "application/json"}


async def _get(path: str, params: dict, *, budget: CallBudget | None, context: dict | None = None,
               ttl: int | None = None) -> tuple[dict, dict]:
    """GET with caching. Returns (json, meta) where meta has cache/retrieved info."""
    if not configured():
        raise ProviderError(PROVIDER, "not_configured", "QLOO_API_KEY is not set in .env")
    clean = {k: v for k, v in params.items() if v not in (None, "", [])}
    qh = cache.query_hash(PROVIDER, path, clean, context, API_VERSION + "|" + settings.QLOO_BASE_URL)
    hit = await cache.get(PROVIDER, qh)
    if hit is not None:
        if budget:
            budget.cache_hits += 1
        return hit.response, {"cached": True, "retrieved_at": hit.retrieved_at.isoformat(), "query_hash": qh,
                              "endpoint": path, "params": clean}
    if budget:
        budget.take()
    url = settings.QLOO_BASE_URL.rstrip("/") + path
    try:
        resp = await request(PROVIDER, "GET", url, headers=_headers(), params=clean,
                             timeout=settings.QLOO_REQUEST_TIMEOUT_SECONDS, attempts=3)
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
                  "endpoint": path, "params": clean}


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
        "popularity": e.get("popularity"),
        "affinity": q.get("affinity"),
        "affinity_rank": q.get("affinity_rank"),
        "measurements": q.get("measurements"),
        "disambiguation": e.get("disambiguation") or props.get("short_description") or "",
        "address": props.get("address") or "",
        "geocode": props.get("geocode") or {},
        "lat": loc.get("lat"),
        "lon": loc.get("lon") if loc.get("lon") is not None else loc.get("lng"),
        "business_rating": props.get("business_rating"),
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
    return [_entity(e) for e in results], meta


async def tags(query: str, take: int = 10, tag_types: list[str] | None = None,
               budget: CallBudget | None = None) -> tuple[list[dict], dict]:
    params: dict[str, Any] = {"filter.query": query, "take": take}
    if tag_types:
        params["filter.tag.types"] = ",".join(tag_types)
    data, meta = await _get("/v2/tags", params, budget=budget)
    res = data.get("results") or {}
    raw = res.get("tags") if isinstance(res, dict) else res
    out = [{"qloo_id": t.get("id") or t.get("tag_id"), "name": t.get("name"), "type": t.get("type") or "tag",
            "parents": t.get("parents")} for t in (raw or [])]
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


async def places_near(lat: float, lon: float, radius_m: int, *, entity_ids: list[str], tag_ids: list[str],
                      filter_tags: list[str] | None = None, take: int = 30, page: int = 1,
                      budget: CallBudget | None = None, context: dict | None = None) -> tuple[list[dict], dict]:
    """Places near a point, ranked by affinity to the supplied signals."""
    params: dict[str, Any] = {
        "filter.type": "urn:entity:place",
        "filter.location": f"POINT({lon:.6f} {lat:.6f})",
        "filter.location.radius": int(radius_m),
        "take": take, "page": page, **_signals(entity_ids, tag_ids)}
    if filter_tags:
        params["filter.tags"] = ",".join(filter_tags)
    data, meta = await _get("/v2/insights", params, budget=budget, context=context)
    ents = ((data.get("results") or {}).get("entities")) or []
    _empty_note(meta, ents)
    return [_entity(e) for e in ents], meta


async def insights_in_location(entity_type: str, location_query: str, *, entity_ids: list[str], tag_ids: list[str],
                               take: int = 15, budget: CallBudget | None = None) -> tuple[list[dict], dict]:
    """Entities of one type with affinity to the signals, filtered to a locality."""
    params = {"filter.type": entity_type, "filter.location.query": location_query, "take": take,
              **_signals(entity_ids, tag_ids)}
    data, meta = await _get("/v2/insights", params, budget=budget)
    ents = ((data.get("results") or {}).get("entities")) or []
    meta["locality"] = ((data.get("query") or {}).get("localities") or {}).get("filter")
    _empty_note(meta, ents)
    return [_entity(e) for e in ents], meta


async def heatmap(*, location_query: str | None = None, wkt: str | None = None, entity_ids: list[str],
                  tag_ids: list[str], budget: CallBudget | None = None) -> tuple[list[dict], dict]:
    """Locality heatmap: grid points with affinity, affinity_rank (rank-normalized
    within THIS result set) and popularity, for the given signal only.
    `urn:heatmap` is documented in Qloo's heatmap guide but is not in the
    hackathon guide's list of supported filter.type values; if the key lacks
    it, Qloo answers 403 and this raises kind='unsupported'."""
    params: dict[str, Any] = {"filter.type": "urn:heatmap", **_signals(entity_ids, tag_ids)}
    if wkt:
        params["filter.location"] = wkt
    else:
        params["filter.location.query"] = location_query
    data, meta = await _get("/v2/insights", params, budget=budget)
    pts = ((data.get("results") or {}).get("heatmap")) or []
    out = [{"lat": (p.get("location") or {}).get("latitude"), "lon": (p.get("location") or {}).get("longitude"),
            "geohash": (p.get("location") or {}).get("geohash"), **(p.get("query") or {})} for p in pts]
    meta["locality"] = ((data.get("query") or {}).get("localities") or {}).get("filter")
    return out, meta


async def probe() -> dict:
    """Readiness: configured, reachable, authorized, and which operations work."""
    out = {"configured": configured(), "reachable": None, "authorized": None, "operations": {}}
    if not configured():
        out["message"] = "QLOO_API_KEY is missing from .env; taste signals are unavailable and rankings will be incomplete."
        return out
    try:
        res, _ = await search("Starbucks", ["urn:entity:brand"], take=1)
        out.update(reachable=True, authorized=True)
        out["operations"]["search"] = "supported" if res else "reachable_no_results"
    except ProviderError as e:
        out["reachable"] = e.kind not in ("transient",)
        out["authorized"] = e.kind != "auth"
        out["operations"]["search"] = e.kind
        out["message"] = e.message
        return out
    checks = (("tags", tags("cricket", take=1)),
              ("insights_place_location", _get("/v2/insights", {"filter.type": "urn:entity:place",
                                                                "filter.location.query": "Kolkata", "take": 1}, budget=None)),
              ("heatmap", _get("/v2/insights", {"filter.type": "urn:heatmap", "filter.location.query": "Kolkata",
                                                "signal.interests.tags": "urn:tag:genre:media:comedy"}, budget=None)))
    for name, coro in checks:
        try:
            _, meta = await coro
            out["operations"][name] = "reachable_no_results" if meta.get("no_results") else "supported"
        except ProviderError as e:
            out["operations"][name] = e.kind
    return out
