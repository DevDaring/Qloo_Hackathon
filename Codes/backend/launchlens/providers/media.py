"""Image and video generation router with an ordered fallback chain.

Owner's order (2026-10-11):
  images: xAI (direct) → NanoGPT (primary key, then fallback key) → OpenRouter (two accounts)
  video:  xAI (direct) → NanoGPT (primary key, then fallback key)      (OpenRouter has no video models)

A provider is skipped only when it cannot serve at all — not configured, key
rejected, out of credit, rate limited or unreachable. Content refusals and
invalid input are never retried elsewhere, and a submission whose outcome is
unknown is never resubmitted (no paying twice). Video run ids tell which
provider owns them (NanoGPT ids start with "vid_"), so polling always goes
back to the right place.
"""
from __future__ import annotations

import logging

from ..config import settings
from . import nanogpt, openrouter_image, xai
from .base import ProviderError

log = logging.getLogger("launchlens.media")

_IMAGE = {"xai": xai, "nanogpt": nanogpt, "openrouter": openrouter_image}
_VIDEO = {"xai": xai, "nanogpt": nanogpt}


def _chain(kind: str) -> list[str]:
    table = _IMAGE if kind == "image" else _VIDEO
    raw = settings.MEDIA_IMAGE_CHAIN if kind == "image" else settings.MEDIA_VIDEO_CHAIN
    out = []
    for name in (n.strip() for n in raw.split(",")):
        if name in table and name not in out and table[name].configured():
            out.append(name)
    return out


def primary(kind: str = "image") -> str:
    c = _chain(kind)
    return c[0] if c else "xai"


def configured() -> bool:
    return bool(_chain("image") or _chain("video"))


def image_model() -> str:
    return {"xai": settings.XAI_IMAGE_MODEL, "nanogpt": settings.NANOGPT_IMAGE_MODEL,
            "openrouter": settings.OPENROUTER_IMAGE_MODEL}[primary("image")]


def video_model() -> str:
    return {"xai": settings.XAI_VIDEO_MODEL, "nanogpt": settings.NANOGPT_VIDEO_MODEL}[primary("video")]


def _unavailable(e: ProviderError) -> bool:
    """This provider cannot serve right now (not a refusal or bad input): the next one may."""
    low = (e.message or "").lower()
    return (e.kind in ("not_configured", "auth", "transient", "rate_limited")
            or e.status in (402, 403)
            or any(w in low for w in ("credit", "balance", "insufficient", "spending limit", "quota")))


async def _image(prompt: str, aspect_ratio: str, reference: str | None) -> dict:
    last: ProviderError | None = None
    for name in _chain("image"):
        try:
            if name == "xai":
                res = await (xai.edit_image(prompt, reference, aspect_ratio=aspect_ratio) if reference
                             else xai.generate_image(prompt, aspect_ratio=aspect_ratio))
            elif name == "nanogpt":
                res = await (nanogpt.edit_image(prompt, reference, aspect_ratio=aspect_ratio) if reference
                             else nanogpt.generate_image(prompt, aspect_ratio=aspect_ratio))
            else:
                res = await openrouter_image.generate(prompt, aspect_ratio=aspect_ratio, reference=reference)
            return {**res, "provider": res.get("provider", name)}
        except ProviderError as e:
            if e.kind == "submission_unknown" or not _unavailable(e):
                raise
            log.warning("image provider %s unavailable (%s); trying the next one", name, e.kind)
            last = e
    raise last or ProviderError("media", "not_configured", "No image generation provider is configured")


async def generate_image(prompt: str, *, aspect_ratio: str = "1:1") -> dict:
    return await _image(prompt, aspect_ratio, None)


async def edit_image(prompt: str, reference: str, *, aspect_ratio: str = "1:1") -> dict:
    return await _image(prompt, aspect_ratio, reference)


async def start_video(prompt: str, seconds: int, aspect_ratio: str, *, image_ref: str | None) -> tuple[str, str, str]:
    """Submit one clip. Returns (run_id, provider, model)."""
    last: ProviderError | None = None
    for name in _chain("video"):
        try:
            if name == "xai":
                body = xai.video_body(prompt, seconds, aspect_ratio, model=settings.XAI_VIDEO_MODEL, image_ref=image_ref)
                return await xai.start_video(body), "xai", settings.XAI_VIDEO_MODEL
            body = nanogpt.video_body(prompt, seconds, aspect_ratio, image_ref=image_ref)
            return await nanogpt.start_video(body), "nanogpt", body["model"]
        except ProviderError as e:
            if e.kind == "submission_unknown" or not _unavailable(e):
                raise
            log.warning("video provider %s unavailable (%s); trying the next one", name, e.kind)
            last = e
    raise last or ProviderError("media", "not_configured", "No video generation provider is configured")


async def poll_video(run_id: str) -> dict:
    if run_id.startswith(nanogpt.VIDEO_PREFIX):
        return await nanogpt.poll_video(run_id)
    return await xai.poll_video(run_id)


def data_uri(data: bytes, mime: str = "image/png") -> str:
    return xai.data_uri(data, mime)


async def probe() -> dict:
    """Status of the chain: the first provider that works is what users get."""
    import asyncio
    x, n = await asyncio.gather(xai.probe(), nanogpt.probe(), return_exceptions=True)
    x = x if isinstance(x, dict) else {"configured": xai.configured(), "authorized": None, "message": str(x)[:200]}
    n = n if isinstance(n, dict) else {"configured": nanogpt.configured(), "authorized": None, "message": str(n)[:200]}
    providers = {"xai": x, "nanogpt": n, "openrouter": {"configured": openrouter_image.configured(), "images_only": True}}
    working = next((p for p in _chain("image") if providers[p].get("authorized") or p == "openrouter"), None)
    head = providers.get(working) or x
    return {"configured": configured(), "reachable": head.get("reachable"), "authorized": head.get("authorized"),
            "operations": head.get("operations") or {}, "message": head.get("message"),
            "primary": primary("image"), "serving": working, "image_chain": _chain("image"),
            "video_chain": _chain("video"), "providers": providers, "keys": n.get("keys") or {},
            "image_model": image_model(), "video_model": video_model()}
