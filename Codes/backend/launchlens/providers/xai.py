"""Direct xAI (Grok Imagine) adapter for images and video. Not Groq.

Verified against the account on 2026-10-08 (GET /v1/image-generation-models,
GET /v1/video-generation-models): grok-imagine-image, grok-imagine-image-2.0,
grok-imagine-image-quality, grok-imagine-video, grok-imagine-video-1.5,
grok-imagine-video-1.5-lite.

  POST /v1/images/generations  {model, prompt, n, aspect_ratio, resolution, response_format}
  POST /v1/images/edits        {model, prompt, image:{url}, aspect_ratio, response_format}
  POST /v1/videos/generations  {model, prompt, duration 1-15, aspect_ratio, resolution, image:{url}}
  GET  /v1/videos/{request_id} status pending|done|expired|failed; video.url is temporary

The video limits below were learned against the API by the owner's Adotopia
deployment (2026-09-24) and are re-read from refusals rather than assumed.
Billing is read from usage.cost_in_usd_ticks (1 USD = 10^10 ticks).
"""
from __future__ import annotations

import base64
import logging
import re
from decimal import Decimal

import httpx

from ..config import settings
from .base import ProviderError, classify, request

log = logging.getLogger("launchlens.xai")
PROVIDER = "xai"
TICKS_PER_USD = Decimal(10_000_000_000)

IMAGE_ASPECTS = ("1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "9:19.5", "19.5:9", "9:20", "20:9", "1:2", "2:1",
                 "21:9", "5:2", "auto")
VIDEO_ASPECTS = ("1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3")
VIDEO_RESOLUTIONS = ("480p", "720p", "1080p")
MIN_SECONDS, MAX_SECONDS = 1, 15
MAX_PROMPT = 4096
_PROMPT_CAP = re.compile(r"prompt length exceeds the maximum allowed length of (\d+)", re.I)
_CAP_SAID = re.compile(r"maximum allowed for ([a-z0-9-]+), which is (\d+)\s*s", re.I)


def configured() -> bool:
    return bool(settings.XAI_API_KEY)


def _headers() -> dict:
    if not configured():
        raise ProviderError(PROVIDER, "not_configured", "XAI_API_KEY (or GROK_API_KEY) is not set in .env")
    return {"Authorization": f"Bearer {settings.XAI_API_KEY}", "Content-Type": "application/json"}


def ticks_to_usd(ticks) -> Decimal | None:
    try:
        return (Decimal(int(ticks)) / TICKS_PER_USD).quantize(Decimal("0.000001")) if ticks is not None else None
    except (TypeError, ValueError):
        return None


def data_uri(data: bytes, mime: str = "image/png") -> str:
    return f"data:{mime};base64,{base64.b64encode(data).decode()}"


def fit_prompt(prompt: str, limit: int = MAX_PROMPT) -> str:
    if len(prompt) <= limit:
        return prompt
    cut = prompt[:limit].rsplit(" ", 1)[0]
    return cut if len(cut) > limit * 0.8 else prompt[:limit]


# ---------------------------------------------------------------- images ----
async def generate_image(prompt: str, *, aspect_ratio: str = "1:1", model: str | None = None,
                         resolution: str = "1k") -> dict:
    """One image. Returns {bytes, mime, cost_usd, model, request_meta}.
    Raises ProviderError; a timeout after sending is `submission_unknown`."""
    model = model or settings.XAI_IMAGE_MODEL
    if aspect_ratio not in IMAGE_ASPECTS:
        raise ProviderError(PROVIDER, "invalid_input", f"aspect ratio {aspect_ratio} is not supported for images")
    body = {"model": model, "prompt": fit_prompt(prompt), "n": 1, "aspect_ratio": aspect_ratio,
            "response_format": "b64_json"}
    if model == "grok-imagine-image-2.0":
        body["resolution"] = resolution
    resp = await request(PROVIDER, "POST", settings.XAI_BASE_URL.rstrip("/") + "/images/generations",
                         headers=_headers(), json=body, timeout=180, attempts=2, paid=True)
    return _image_result(resp.json(), model)


async def edit_image(prompt: str, reference: str, *, aspect_ratio: str = "1:1", model: str | None = None) -> dict:
    """Image edit / reference-guided generation from a data URI or public URL."""
    model = model or settings.XAI_IMAGE_MODEL
    body = {"model": model, "prompt": fit_prompt(prompt), "n": 1, "image": {"url": reference},
            "aspect_ratio": aspect_ratio, "response_format": "b64_json"}
    resp = await request(PROVIDER, "POST", settings.XAI_BASE_URL.rstrip("/") + "/images/edits",
                         headers=_headers(), json=body, timeout=180, attempts=2, paid=True)
    return _image_result(resp.json(), model)


def _image_result(data: dict, model: str) -> dict:
    items = data.get("data") or []
    if not items:
        raise ProviderError(PROVIDER, "failed", "xAI returned no image")
    item = items[0]
    if item.get("b64_json"):
        raw = base64.b64decode(item["b64_json"])
    else:
        raise ProviderError(PROVIDER, "failed", "xAI returned no inline image data")
    usage = data.get("usage") or {}
    mime = item.get("mime_type") or ("image/png" if raw[:4] == b"\x89PNG" else "image/jpeg")
    return {"bytes": raw, "mime": mime, "cost_usd": ticks_to_usd(usage.get("cost_in_usd_ticks")),
            "model": model, "revised_prompt": item.get("revised_prompt")}


# ---------------------------------------------------------------- video -----
def video_body(prompt: str, seconds: int, aspect_ratio: str, *, model: str, image_ref: str | None,
               resolution: str | None = None, generate_audio: bool = False) -> dict:
    if aspect_ratio not in VIDEO_ASPECTS:
        raise ProviderError(PROVIDER, "invalid_input", f"aspect ratio {aspect_ratio} not supported for video")
    res = resolution or settings.XAI_VIDEO_RESOLUTION
    if res not in VIDEO_RESOLUTIONS:
        raise ProviderError(PROVIDER, "invalid_input", f"resolution {res} not supported for video")
    body = {"model": model, "prompt": fit_prompt(prompt), "duration": max(MIN_SECONDS, min(MAX_SECONDS, int(seconds))),
            "aspect_ratio": aspect_ratio, "resolution": res}
    if image_ref:
        body["image"] = {"url": image_ref}
    if not generate_audio:
        body["generate_audio"] = False
    return body


async def start_video(body: dict) -> str:
    """Submit; returns the request_id. Re-reads a stated cap once."""
    url = settings.XAI_BASE_URL.rstrip("/") + "/videos/generations"
    async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=15)) as client:
        try:
            resp = await client.post(url, headers=_headers(), json=body)
        except (httpx.ReadTimeout, httpx.WriteTimeout, httpx.RemoteProtocolError):
            raise ProviderError(PROVIDER, "submission_unknown",
                                "video submission sent but no response received; it may have been accepted") from None
        except httpx.TransportError as e:
            raise ProviderError(PROVIDER, "transient", f"could not reach xAI ({type(e).__name__})") from None
        if resp.status_code == 400:
            text = resp.text or ""
            said, long_prompt = _CAP_SAID.search(text), _PROMPT_CAP.search(text)
            if said or long_prompt:
                body = dict(body)
                if said:
                    body["duration"] = min(body["duration"], int(said.group(2)))
                if long_prompt:
                    body["prompt"] = fit_prompt(body["prompt"], max(256, int(long_prompt.group(1))))
                log.warning("xAI stated a limit; resubmitting once within it")
                try:
                    resp = await client.post(url, headers=_headers(), json=body)
                except (httpx.ReadTimeout, httpx.WriteTimeout, httpx.RemoteProtocolError):
                    raise ProviderError(PROVIDER, "submission_unknown", "video resubmission outcome unknown") from None
    if not resp.is_success:
        raise classify(PROVIDER, resp)
    rid = str((resp.json() or {}).get("request_id") or "")
    if not rid:
        raise ProviderError(PROVIDER, "submission_unknown", "xAI accepted the request but returned no request_id")
    return rid


async def poll_video(request_id: str) -> dict:
    """{state: pending|done|failed|expired, url, duration, cost_usd, error}"""
    url = settings.XAI_BASE_URL.rstrip("/") + f"/videos/{request_id}"
    try:
        resp = await request(PROVIDER, "GET", url, headers=_headers(), timeout=60, attempts=3)
    except ProviderError as e:
        if e.kind == "not_found":
            return {"state": "failed", "error": "xAI has no record of this request (expired?)"}
        if e.retryable:
            return {"state": "pending", "error": None, "transient": e.message}
        raise
    data = resp.json() or {}
    status = str(data.get("status") or "").lower()
    if status == "done":
        video = data.get("video") or {}
        if not video.get("url"):
            why = "refused by moderation" if video.get("respect_moderation") is False else "no video returned"
            return {"state": "failed", "error": why}
        return {"state": "done", "url": video["url"], "duration": video.get("duration"),
                "cost_usd": ticks_to_usd((data.get("usage") or {}).get("cost_in_usd_ticks")),
                "model": data.get("model")}
    if status in ("failed", "expired"):
        err = (data.get("error") or {})
        return {"state": status, "error": f'{err.get("code", status)}: {err.get("message", "")}'.strip(": ")}
    return {"state": "pending", "error": None}


async def list_models() -> dict:
    out = {}
    for kind in ("image", "video"):
        resp = await request(PROVIDER, "GET", settings.XAI_BASE_URL.rstrip("/") + f"/{kind}-generation-models",
                             headers=_headers(), timeout=20, attempts=2)
        out[kind] = [m.get("id") for m in (resp.json().get("models") or [])]
    return out


async def probe() -> dict:
    out = {"configured": configured(), "reachable": None, "authorized": None, "operations": {},
           "image_model": settings.XAI_IMAGE_MODEL, "video_model": settings.XAI_VIDEO_MODEL}
    if not configured():
        out["message"] = "XAI_API_KEY missing: image and video generation are unavailable."
        return out
    try:
        models = await list_models()
        out.update(reachable=True, authorized=True)
        out["operations"]["image_generation"] = "supported" if settings.XAI_IMAGE_MODEL in models["image"] else "model_not_listed"
        out["operations"]["image_edit"] = out["operations"]["image_generation"]
        out["operations"]["video_generation"] = "supported" if settings.XAI_VIDEO_MODEL in models["video"] else "model_not_listed"
        out["available_models"] = models
    except ProviderError as e:
        out["reachable"] = e.kind != "transient"
        out["authorized"] = e.kind != "auth"
        out["message"] = e.message
    return out
