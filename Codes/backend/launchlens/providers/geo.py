"""Geocoding, supplementary place data and historical climate.

Geocoding: Nominatim-compatible API (GEOCODING_BASE_URL). The public instance
allows at most 1 request/second with an identifying User-Agent and requires
caching; both are enforced here. Point GEOCODING_BASE_URL at a commercial or
self-hosted instance for heavier use.

Places: OpenStreetMap via the Overpass API (PLACES_BASE_URL), an explicitly
identified supplementary source (ODbL, attribution "© OpenStreetMap
contributors"). Results are the *retrieved set* within a bounded radius, not a
census of businesses.

Climate: Open-Meteo historical archive (ERA5 reanalysis), daily maximum
temperature over full calendar years. This is historical climate from a
reanalysis model, not a forecast and not a station observation. A single
day's temperature is never used as a climate classification.
"""
from __future__ import annotations

import asyncio
import logging
import math
import time
from datetime import UTC, datetime
from statistics import mean

from ..config import settings
from ..services import cache
from .base import ProviderError, request

log = logging.getLogger("launchlens.geo")
UA = {"User-Agent": f"LaunchLens/1.0 ({settings.APP_BASE_URL}; {settings.GEOCODING_CONTACT_EMAIL or 'contact via site'})"}
_nominatim_lock = asyncio.Lock()
_overpass_lock = asyncio.Lock()
_last_call = 0.0


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6_371_008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


# ---------------------------------------------------------------- geocoding --
async def geocode(query: str, country_codes: str = "", limit: int = 6) -> tuple[list[dict], dict]:
    global _last_call
    params = {"q": query, "format": "jsonv2", "limit": limit, "addressdetails": 1, "polygon_geojson": 0}
    if country_codes:
        params["countrycodes"] = country_codes.lower()
    qh = cache.query_hash("nominatim", "/search", params, version=settings.GEOCODING_BASE_URL)
    hit = await cache.get("nominatim", qh)
    if hit:
        data = hit.response.get("items", [])
        meta = {"cached": True, "retrieved_at": hit.retrieved_at.isoformat()}
    else:
        async with _nominatim_lock:
            wait = 1.1 - (time.monotonic() - _last_call)
            if wait > 0:
                await asyncio.sleep(wait)
            headers = dict(UA)
            if settings.GEOCODING_API_KEY:
                params["key"] = settings.GEOCODING_API_KEY
            resp = await request("nominatim", "GET", settings.GEOCODING_BASE_URL.rstrip("/") + "/search",
                                 headers=headers, params=params, timeout=20, attempts=2)
            _last_call = time.monotonic()
        params.pop("key", None)
        data = resp.json()
        await cache.put("nominatim", "/search", qh, params, {"items": data}, 30 * 86400, redistributable=True)
        meta = {"cached": False, "retrieved_at": datetime.now(UTC).isoformat()}
    out = []
    for d in data:
        addr = d.get("address") or {}
        bb = d.get("boundingbox") or []
        out.append({
            "label": d.get("display_name"), "lat": float(d["lat"]), "lon": float(d["lon"]),
            "type": d.get("type"), "category": d.get("category") or d.get("class"),
            "importance": d.get("importance"), "osm_type": d.get("osm_type"), "osm_id": d.get("osm_id"),
            "country_code": (addr.get("country_code") or "").upper(),
            "state": addr.get("state") or "", "city": addr.get("city") or addr.get("town") or addr.get("village") or "",
            "bbox": [float(x) for x in bb] if len(bb) == 4 else None,
            "source": "OpenStreetMap Nominatim", "attribution": "© OpenStreetMap contributors (ODbL)"})
    meta["source"] = "nominatim"
    return out, meta


# ---------------------------------------------------------------- places -----
# OSM tag -> (app category, role, role_basis). Competitors here are only
# INFERRED category peers (shops whose tags say they sell mobility/medical
# supplies); a confirmed competitor needs the owner's confirmation.
OSM_CATEGORIES: list[tuple[str, str, str, str]] = [
    ('nwr["shop"="medical_supply"]', "medical_supply_store", "competitor", "inferred_category"),
    ('nwr["shop"="mobility_scooter"]', "mobility_store", "competitor", "inferred_category"),
    ('nwr["amenity"="pharmacy"]', "pharmacy", "partner", "inferred_category"),
    ('nwr["healthcare"="physiotherapist"]', "physiotherapy", "partner", "inferred_category"),
    ('nwr["amenity"="hospital"]', "hospital", "institution", "inferred_category"),
    ('nwr["amenity"="clinic"]', "clinic", "institution", "inferred_category"),
    ('nwr["amenity"="social_facility"]', "social_facility", "institution", "inferred_category"),
    ('nwr["amenity"="community_centre"]', "community_centre", "venue", "inferred_category"),
    ('nwr["shop"="mall"]', "shopping_mall", "venue", "inferred_category"),
    ('nwr["shop"="electronics"]', "electronics_store", "partner", "inferred_category"),
]
_CAT_BY_TAG = {
    ("shop", "medical_supply"): OSM_CATEGORIES[0], ("shop", "mobility_scooter"): OSM_CATEGORIES[1],
    ("amenity", "pharmacy"): OSM_CATEGORIES[2], ("healthcare", "physiotherapist"): OSM_CATEGORIES[3],
    ("amenity", "hospital"): OSM_CATEGORIES[4], ("amenity", "clinic"): OSM_CATEGORIES[5],
    ("amenity", "social_facility"): OSM_CATEGORIES[6], ("amenity", "community_centre"): OSM_CATEGORIES[7],
    ("shop", "mall"): OSM_CATEGORIES[8], ("shop", "electronics"): OSM_CATEGORIES[9],
}
MAX_PLACES_PER_AREA = 400


async def osm_places(lat: float, lon: float, radius_m: int) -> tuple[list[dict], dict]:
    radius_m = int(min(max(radius_m, 500), 8000))
    selectors = "".join(f"{sel}(around:{radius_m},{lat:.5f},{lon:.5f});" for sel, *_ in OSM_CATEGORIES)
    ql = f"[out:json][timeout:60];({selectors});out center tags {MAX_PLACES_PER_AREA};"
    params = {"lat": round(lat, 5), "lon": round(lon, 5), "radius_m": radius_m, "v": 2}
    qh = cache.query_hash("osm-overpass", "/interpreter", params, version=settings.PLACES_BASE_URL)
    hit = await cache.get("osm-overpass", qh)
    if hit:
        elements, retrieved = hit.response.get("elements", []), hit.retrieved_at.isoformat()
        cached = True
    else:
        # The public Overpass instance allows very few concurrent slots per client:
        # one query at a time, with a patient backoff on 429/504.
        async with _overpass_lock:
            for attempt in range(4):
                try:
                    resp = await request("osm-overpass", "GET", settings.PLACES_BASE_URL, headers=UA, timeout=90,
                                         attempts=1, params={"data": ql})
                    break
                except ProviderError as e:
                    if not e.retryable or attempt == 3:
                        raise
                    await asyncio.sleep(e.retry_after or 8 * (attempt + 1))
        elements = resp.json().get("elements", [])
        await cache.put("osm-overpass", "/interpreter", qh, params, {"elements": elements}, 7 * 86400,
                        redistributable=True)
        retrieved, cached = datetime.now(UTC).isoformat(), False
    out = []
    for el in elements:
        tags = el.get("tags") or {}
        plat = el.get("lat") or (el.get("center") or {}).get("lat")
        plon = el.get("lon") or (el.get("center") or {}).get("lon")
        if plat is None or plon is None:
            continue
        match = next((_CAT_BY_TAG[(k, tags[k])] for k in ("shop", "amenity", "healthcare") if (k, tags.get(k)) in _CAT_BY_TAG), None)
        if not match:
            continue
        _, category, role, basis = match
        name = tags.get("name") or tags.get("name:en") or ""
        if not name:
            continue  # unnamed features are not actionable placements
        addr = ", ".join(x for x in (tags.get("addr:housenumber"), tags.get("addr:street"), tags.get("addr:suburb"),
                                     tags.get("addr:city"), tags.get("addr:postcode")) if x)
        wheelchair = tags.get("wheelchair")
        out.append({
            "provider": "osm-overpass", "provider_id": f'{el.get("type")}/{el.get("id")}', "name": name,
            "category": category, "role": role, "role_basis": basis, "lat": float(plat), "lon": float(plon),
            "address": addr, "provider_categories": [f"{k}={tags[k]}" for k in ("shop", "amenity", "healthcare") if k in tags],
            # OSM wheelchair=yes is community-mapped, not a certification.
            "accessibility": f"osm_reported_{wheelchair}" if wheelchair in ("yes", "limited", "no") else "unknown",
            "distance_m": round(haversine_m(lat, lon, float(plat), float(plon)), 1),
            "metadata": {k: tags[k] for k in ("opening_hours", "operator", "brand", "website", "healthcare:speciality",
                                              "social_facility", "social_facility:for") if k in tags},
        })
    return out, {"cached": cached, "retrieved_at": retrieved, "radius_m": radius_m, "query": ql,
                 "source": "OpenStreetMap via Overpass API", "attribution": "© OpenStreetMap contributors (ODbL)",
                 "limit": MAX_PLACES_PER_AREA}


# ---------------------------------------------------------------- climate ----
async def climate_summary(lat: float, lon: float, years: tuple[int, int] = (2023, 2025)) -> tuple[dict, dict]:
    params = {"latitude": round(lat, 3), "longitude": round(lon, 3), "start_date": f"{years[0]}-01-01",
              "end_date": f"{years[1]}-12-31", "daily": "temperature_2m_max,apparent_temperature_max",
              "timezone": "UTC"}
    qh = cache.query_hash("open-meteo", "/archive", params, version=settings.WEATHER_BASE_URL)
    hit = await cache.get("open-meteo", qh)
    if hit:
        data, retrieved, cached = hit.response, hit.retrieved_at.isoformat(), True
    else:
        if settings.WEATHER_API_KEY:
            params["apikey"] = settings.WEATHER_API_KEY
        resp = await request("open-meteo", "GET", settings.WEATHER_BASE_URL, params=params, timeout=60, attempts=3)
        params.pop("apikey", None)
        data = resp.json()
        await cache.put("open-meteo", "/archive", qh, params, data, 30 * 86400, redistributable=True)
        retrieved, cached = datetime.now(UTC).isoformat(), False
    daily = data.get("daily") or {}
    dates, tmax, app = daily.get("time") or [], daily.get("temperature_2m_max") or [], daily.get("apparent_temperature_max") or []
    if not dates:
        raise ProviderError("open-meteo", "failed", "no climate data returned for this location")
    by_month: dict[int, list[float]] = {m: [] for m in range(1, 13)}
    hot_days = 0
    hot_app_days = 0
    for d, t, a in zip(dates, tmax, app or [None] * len(dates), strict=False):
        if t is None:
            continue
        by_month[int(d[5:7])].append(float(t))
        hot_days += 1 if t >= 35.0 else 0
        hot_app_days += 1 if (a is not None and a >= 40.0) else 0
    n_years = years[1] - years[0] + 1
    monthly = {m: round(mean(v), 1) for m, v in by_month.items() if v}
    summary = {
        "monthly_mean_daily_max_c": monthly,
        "hot_days_per_year_tmax_ge_35c": round(hot_days / n_years, 1),
        "days_per_year_apparent_ge_40c": round(hot_app_days / n_years, 1),
        "hottest_month_mean_max_c": max(monthly.values()) if monthly else None,
        "period": f"{years[0]}-01-01..{years[1]}-12-31", "units": "°C", "n_days": len(dates),
    }
    return summary, {"cached": cached, "retrieved_at": retrieved,
                     "source": "Open-Meteo Historical Weather API (ERA5 reanalysis)",
                     "source_ref": settings.WEATHER_BASE_URL, "kind": "historical_reanalysis",
                     "attribution": "Weather data by Open-Meteo.com (CC BY 4.0)"}


async def probe() -> dict:
    out: dict = {"geocoding": {"provider": settings.GEOCODING_PROVIDER, "base_url": settings.GEOCODING_BASE_URL},
                 "places": {"provider": settings.PLACES_PROVIDER}, "climate": {"provider": settings.WEATHER_PROVIDER}}
    try:
        r, _ = await geocode("Kolkata", "in", limit=1)
        out["geocoding"].update(reachable=True, operation="supported" if r else "no_results")
    except ProviderError as e:
        out["geocoding"].update(reachable=False, message=e.message)
    out["places"]["note"] = "Overpass is queried per research run (bounded radius, cached 7 days)."
    out["climate"]["note"] = "Open-Meteo archive is queried per research run (cached 30 days)."
    return out
