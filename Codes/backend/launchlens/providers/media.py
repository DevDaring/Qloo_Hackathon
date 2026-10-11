"""Image and video generation router: NanoGPT first (primary key, then
fallback key), then direct xAI only if MEDIA_XAI_FALLBACK is on and NanoGPT
cannot serve the request at all (not configured, keys rejected, no balance,
or unreachable). Content refusals and invalid input are never retried
elsewhere. Video run ids tell which provider owns them (NanoGPT ids start
with "vid_"), so polling always goes back to the right place."""
from __future__ import annotations

import logging

from ..config import settings
from . import nanogpt, openrouter_image, xai
from .base import ProviderError

log = logging.getLogger("launchlens.media")


def primary() -> str:
    return "nanogpt" if settings.MEDIA_PROVIDER == "nanogpt" and nanogpt.configured() else "xai"


def configured() -> bool:
    return nanogpt.configured() or openrouter_image.configured() or xai.configured()


def image_model() -> str:
    return settings.NANOGPT_IMAGE_MODEL if primary() == "nanogpt" else settings.XAI_IMAGE_MODEL


def video_model() -> str:
    return settings.NANOGPT_VIDEO_MODEL if primary() == "nanogpt" else settings.XAI_VIDEO_MODEL


def _unavailable(e: ProviderError) -> bool:
    """NanoGPT cannot serve at all (not a refusal or bad input): another provider may."""
    return e.kind in ("not_configured", "auth", "transient") or nanogpt._key_problem(e)


def _can_fall_back(e: ProviderError) -> bool:
    return settings.MEDIA_XAI_FALLBACK and xai.configured() and _unavailable(e)


async def _image_fallbacks(prompt: str, aspect_ratio: str, reference: str | None, err: ProviderError) -> dict:
    """After both NanoGPT keys: OpenRouter (two accounts), then direct xAI if enabled."""
    if openrouter_image.configured():
        try:
            return await openrouter_image.generate(prompt, aspect_ratio=aspect_ratio, reference=reference)
        except ProviderError as e2:
            if not _unavailable(e2) and e2.kind != "failed":
                raise
            log.warning("OpenRouter image fallback unavailable (%s)", e2.kind)
            err = e2
    if not _can_fall_back(err):
        raise err
    res = await (xai.edit_image(prompt, reference, aspect_ratio=aspect_ratio) if reference
                 else xai.generate_image(prompt, aspect_ratio=aspect_ratio))
    return {**res, "provider": "xai"}


async def generate_image(prompt: str, *, aspect_ratio: str = "1:1") -> dict:
    if primary() == "nanogpt":
        try:
            return await nanogpt.generate_image(prompt, aspect_ratio=aspect_ratio)
        except ProviderError as e:
            if not _unavailable(e):
                raise
            log.warning("NanoGPT image unavailable (%s); trying fallbacks", e.kind)
            return await _image_fallbacks(prompt, aspect_ratio, None, e)
    res = await xai.generate_image(prompt, aspect_ratio=aspect_ratio)
    return {**res, "provider": "xai"}


async def edit_image(prompt: str, reference: str, *, aspect_ratio: str = "1:1") -> dict:
    if primary() == "nanogpt":
        try:
            return await nanogpt.edit_image(prompt, reference, aspect_ratio=aspect_ratio)
        except ProviderError as e:
            if not _unavailable(e):
                raise
            log.warning("NanoGPT image edit unavailable (%s); trying fallbacks", e.kind)
            return await _image_fallbacks(prompt, aspect_ratio, reference, e)
    res = await xai.edit_image(prompt, reference, aspect_ratio=aspect_ratio)
    return {**res, "provider": "xai"}


async def start_video(prompt: str, seconds: int, aspect_ratio: str, *, image_ref: str | None) -> tuple[str, str, str]:
    """Submit one clip. Returns (run_id, provider, model)."""
    if primary() == "nanogpt":
        try:
            body = nanogpt.video_body(prompt, seconds, aspect_ratio, image_ref=image_ref)
            return await nanogpt.start_video(body), "nanogpt", body["model"]
        except ProviderError as e:
            if e.kind == "submission_unknown" or not _can_fall_back(e):
                raise
            log.warning("NanoGPT video unavailable (%s); using direct xAI", e.kind)
    body = xai.video_body(prompt, seconds, aspect_ratio, model=settings.XAI_VIDEO_MODEL, image_ref=image_ref)
    return await xai.start_video(body), "xai", settings.XAI_VIDEO_MODEL


async def poll_video(run_id: str) -> dict:
    if run_id.startswith(nanogpt.VIDEO_PREFIX):
        return await nanogpt.poll_video(run_id)
    return await xai.poll_video(run_id)


def data_uri(data: bytes, mime: str = "image/png") -> str:
    return xai.data_uri(data, mime)


async def probe() -> dict:
    n = await nanogpt.probe()
    out = {**n, "primary": primary(), "xai_fallback": bool(settings.MEDIA_XAI_FALLBACK and xai.configured())}
    if primary() == "xai" or not n.get("authorized"):
        x = await xai.probe()
        out["xai"] = x
        if primary() == "xai":
            out.update({k: x.get(k) for k in ("configured", "reachable", "authorized", "operations", "message")})
    return out
