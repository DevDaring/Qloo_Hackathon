"""NanoGPT adapter for image and video generation (Grok Imagine models served
through NanoGPT). One primary key and one fallback key: a key that is rejected
or out of balance hands the request to the next key; other errors do not.

Read from https://docs.nano-gpt.com (2026-10-11) and verified with the account:
  POST {base}/v1/images/generations  {model, prompt, n, size (aspect ratio for grok-imagine-image),
                                      response_format=b64_json, imageDataUrl for reference images}
                                      -> {data:[{b64_json|url}], cost, remainingBalance}
  POST {base}/generate-video          {model, prompt, duration "1".."15", aspect_ratio, resolution,
                                      imageDataUrl} -> 202 {runId "vid_...", status, cost}
  GET  {base}/video/status?requestId= -> data.status IN_QUEUE|IN_PROGRESS|COMPLETED|FAILED|CANCELED,
                                      data.output.video.url (verified: a site-relative
                                      /api/generate-video/content?... link that 302-redirects to a
                                      signed storage URL; no cost field is returned, so the ledger keeps
                                      the price-list estimate)
  POST {base}/check-balance           -> {usd_balance}
Polling is free; submissions are billed. Signed media URLs expire after about an hour.
"""
from __future__ import annotations

import base64
import logging
from decimal import Decimal, InvalidOperation

import httpx

from ..config import settings
from .base import ProviderError, classify, request

log = logging.getLogger("launchlens.nanogpt")
PROVIDER = "nanogpt"
VIDEO_PREFIX = "vid_"
IMAGE_SIZES = ("2:1", "20:9", "19.5:9", "16:9", "4:3", "3:2", "1:1", "2:3", "3:4", "9:16", "9:19.5", "9:20", "1:2")
VIDEO_ASPECTS = ("16:9", "1:1", "9:16")
VIDEO_RESOLUTIONS = ("480p", "720p")
MIN_SECONDS, MAX_SECONDS = 1, 15
MAX_PROMPT = 4096


def keys() -> list[tuple[str, str]]:
    """[(slot, key)] in order: primary, then fallback (deduplicated)."""
    out = []
    for slot, k in (("primary", settings.NANOGPT_API_KEY), ("fallback", settings.NANOGPT_FALLBACK_API_KEY)):
        if k and k not in [x[1] for x in out]:
            out.append((slot, k))
    return out


def configured() -> bool:
    return bool(keys())


def _headers(key: str) -> dict:
    return {"Authorization": f"Bearer {key}", "x-api-key": key, "Content-Type": "application/json"}


def _base() -> str:
    return settings.NANOGPT_BASE_URL.rstrip("/")


def _usd(v) -> Decimal | None:
    try:
        return Decimal(str(v)).quantize(Decimal("0.000001")) if v is not None else None
    except (InvalidOperation, ValueError):
        return None


def _key_problem(e: ProviderError) -> bool:
    """Errors that another key can fix: rejected key, or no balance on this account."""
    low = (e.message or "").lower()
    return e.kind == "auth" or e.status == 402 or "insufficient" in low or "balance" in low or "no credits" in low


async def _with_keys(fn):
    ks = keys()
    if not ks:
        raise ProviderError(PROVIDER, "not_configured", "No NanoGPT key is configured")
    last = None
    for slot, k in ks:
        try:
            out = await fn(k)
            if isinstance(out, dict):
                out["key_slot"] = slot
            return out
        except ProviderError as e:
            if not _key_problem(e):
                raise
            log.warning("NanoGPT %s key unusable (%s); trying the next key", slot, e.kind)
            last = e
    raise last


def fit_prompt(prompt: str, limit: int = MAX_PROMPT) -> str:
    if len(prompt) <= limit:
        return prompt
    cut = prompt[:limit].rsplit(" ", 1)[0]
    return cut if len(cut) > limit * 0.8 else prompt[:limit]


# ---------------------------------------------------------------- images ----
async def _image(body: dict, model: str) -> dict:
    async def call(k):
        resp = await request(PROVIDER, "POST", _base() + "/v1/images/generations", headers=_headers(k), json=body,
                             timeout=180, attempts=2, paid=True)
        return await _image_result(resp.json(), model)
    return await _with_keys(call)


async def generate_image(prompt: str, *, aspect_ratio: str = "1:1", model: str | None = None) -> dict:
    model = model or settings.NANOGPT_IMAGE_MODEL
    if aspect_ratio not in IMAGE_SIZES:
        raise ProviderError(PROVIDER, "invalid_input", f"aspect ratio {aspect_ratio} is not supported for images")
    return await _image({"model": model, "prompt": fit_prompt(prompt), "n": 1, "size": aspect_ratio,
                         "response_format": "b64_json"}, model)


async def edit_image(prompt: str, reference: str, *, aspect_ratio: str = "1:1", model: str | None = None) -> dict:
    """Reference-guided generation; `reference` must be a base64 data URL (NanoGPT does not fetch remote URLs)."""
    model = model or settings.NANOGPT_IMAGE_MODEL
    if not reference.startswith("data:"):
        raise ProviderError(PROVIDER, "invalid_input", "NanoGPT needs reference images as base64 data URLs")
    return await _image({"model": model, "prompt": fit_prompt(prompt), "n": 1, "size": aspect_ratio,
                         "response_format": "b64_json", "imageDataUrl": reference}, model)


async def _image_result(data: dict, model: str) -> dict:
    items = data.get("data") or []
    if not items:
        raise ProviderError(PROVIDER, "failed", "NanoGPT returned no image")
    item = items[0]
    if item.get("b64_json"):
        raw = base64.b64decode(item["b64_json"])
    elif item.get("url"):
        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as c:
            r = await c.get(item["url"])
            if not r.is_success:
                raise ProviderError(PROVIDER, "failed", f"could not download the generated image (HTTP {r.status_code})")
            raw = r.content
    else:
        raise ProviderError(PROVIDER, "failed", "NanoGPT returned no image data")
    mime = "image/png" if raw[:4] == b"\x89PNG" else ("image/webp" if raw[8:12] == b"WEBP" else "image/jpeg")
    return {"bytes": raw, "mime": mime, "cost_usd": _usd(data.get("cost")), "model": model,
            "provider": PROVIDER, "revised_prompt": item.get("revised_prompt")}


# ---------------------------------------------------------------- video -----
def video_body(prompt: str, seconds: int, aspect_ratio: str, *, model: str | None = None, image_ref: str | None,
               resolution: str | None = None, generate_audio: bool = False) -> dict:
    model = model or settings.NANOGPT_VIDEO_MODEL
    if aspect_ratio not in VIDEO_ASPECTS:
        raise ProviderError(PROVIDER, "invalid_input", f"aspect ratio {aspect_ratio} not supported for video")
    res = resolution or settings.XAI_VIDEO_RESOLUTION
    if res not in VIDEO_RESOLUTIONS:
        res = "720p"
    body = {"model": model, "prompt": fit_prompt(prompt), "duration": str(max(MIN_SECONDS, min(MAX_SECONDS, int(seconds)))),
            "aspect_ratio": aspect_ratio, "resolution": res}
    if image_ref:
        if not image_ref.startswith("data:"):
            raise ProviderError(PROVIDER, "invalid_input", "NanoGPT needs the start frame as a base64 data URL")
        body["imageDataUrl"] = image_ref
    return body


async def start_video(body: dict) -> str:
    """Submit; returns the NanoGPT run id ("vid_..."). A timeout after sending is `submission_unknown`."""
    async def call(k):
        async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=15)) as client:
            try:
                resp = await client.post(_base() + "/generate-video", headers=_headers(k), json=body)
            except (httpx.ReadTimeout, httpx.WriteTimeout, httpx.RemoteProtocolError):
                raise ProviderError(PROVIDER, "submission_unknown",
                                    "video submission sent but no response received; it may have been accepted") from None
            except httpx.TransportError as e:
                raise ProviderError(PROVIDER, "transient", f"could not reach NanoGPT ({type(e).__name__})") from None
        if not resp.is_success:
            raise classify(PROVIDER, resp)
        data = resp.json() or {}
        rid = str(data.get("runId") or data.get("id") or "")
        if not rid:
            raise ProviderError(PROVIDER, "submission_unknown", "NanoGPT accepted the request but returned no run id")
        return {"rid": rid}
    return (await _with_keys(call))["rid"]


async def poll_video(run_id: str) -> dict:
    """{state: pending|done|failed, url, cost_usd, error}. Tries each key (the job may belong to either)."""
    last = None
    for _slot, k in keys():
        try:
            resp = await request(PROVIDER, "GET", _base() + "/video/status", headers=_headers(k),
                                 params={"requestId": run_id}, timeout=60, attempts=3)
        except ProviderError as e:
            last = e
            if e.kind in ("not_found", "auth"):
                continue
            if e.retryable:
                return {"state": "pending", "error": None, "transient": e.message}
            raise
        payload = resp.json() or {}
        data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
        status = str(data.get("status") or "").upper()
        if status == "COMPLETED":
            url = (((data.get("output") or {}).get("video") or {}).get("url")) or data.get("videoUrl") or data.get("url")
            if not url:
                return {"state": "failed", "error": "NanoGPT reported completion without a video URL"}
            if url.startswith("/"):
                # NanoGPT returns a site-relative content link that redirects to a signed, expiring storage URL
                from urllib.parse import urlsplit
                b = urlsplit(_base())
                url = f"{b.scheme}://{b.netloc}{url}"
            return {"state": "done", "url": url, "cost_usd": _usd(data.get("cost")), "model": data.get("model")}
        if status in ("FAILED", "CANCELED", "CANCELLED"):
            return {"state": "failed", "error": data.get("userFriendlyError") or data.get("error") or status.lower()}
        return {"state": "pending", "error": None}
    if last and last.kind == "not_found":
        return {"state": "failed", "error": "NanoGPT has no record of this request"}
    return {"state": "pending", "error": None, "transient": last.message if last else "no key"}


async def balance(key: str) -> Decimal | None:
    resp = await request(PROVIDER, "POST", _base() + "/check-balance", headers=_headers(key), timeout=20, attempts=2)
    return _usd((resp.json() or {}).get("usd_balance"))


async def probe() -> dict:
    out = {"configured": configured(), "reachable": None, "authorized": None, "operations": {}, "provider": "NanoGPT",
           "image_model": settings.NANOGPT_IMAGE_MODEL, "video_model": settings.NANOGPT_VIDEO_MODEL, "keys": {}}
    if not configured():
        out["message"] = "No NanoGPT key: image and video generation fall back to direct xAI if enabled."
        return out
    for slot, k in keys():
        try:
            bal = await balance(k)
            out["keys"][slot] = {"accepted": True, "balance_usd": float(bal) if bal is not None else None}
        except ProviderError as e:
            out["keys"][slot] = {"accepted": False, "problem": e.kind}
    ok = any(v.get("accepted") for v in out["keys"].values())
    out.update(reachable=True if out["keys"] else None, authorized=ok)
    if ok:
        try:
            resp = await request(PROVIDER, "GET", _base() + "/v1/image-models", timeout=20, attempts=2)
            ids = {m.get("id") for m in (resp.json().get("data") or [])}
            out["operations"]["image_generation"] = "supported" if settings.NANOGPT_IMAGE_MODEL in ids else "model_not_listed"
            out["operations"]["image_edit"] = out["operations"]["image_generation"]
            resp = await request(PROVIDER, "GET", _base() + "/v1/video-models", timeout=20, attempts=2)
            ids = {m.get("id") for m in (resp.json().get("data") or [])}
            out["operations"]["video_generation"] = "supported" if settings.NANOGPT_VIDEO_MODEL in ids else "model_not_listed"
        except ProviderError as e:
            out["message"] = e.message
    else:
        out["message"] = "NanoGPT rejected every configured key."
    return out
