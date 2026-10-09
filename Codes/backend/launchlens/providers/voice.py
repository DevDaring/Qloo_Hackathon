"""Optional narration (TTS), ported from the owner's Adotopia voice module.

Fish Audio leads for Hindi and Bengali (its pool holds voices verified in those
scripts); fal / ElevenLabs leads for English and catches a Fish outage. When
neither is configured or both fail, the video is still delivered silent with
captions, and its audio state says so.

  Fish: POST {FISH_AUDIO_BASE_URL}/v1/tts, bearer auth, `model` header, raw audio back.
  fal:  POST {FAL_QUEUE_URL}/{FAL_TTS_MODEL}, `Key` auth, poll status_url, fetch audio.url.
"""
from __future__ import annotations

import asyncio
import logging

import httpx

from ..config import settings
from .base import ProviderError

log = logging.getLogger("launchlens.voice")
_TIMEOUT = httpx.Timeout(120.0, connect=15.0)


def configured() -> bool:
    return bool(settings.TTS_API_KEY or settings.FAL_KEY or settings.SARVAM_API_KEY) and settings.TTS_PROVIDER != "none"


def _pool() -> list[tuple[str, str, str]]:
    out = []
    for entry in settings.FISH_AUDIO_VOICE_POOL.split(","):
        parts = entry.strip().split(":")
        if parts and parts[0]:
            out.append((parts[0], parts[1] if len(parts) > 1 else "neutral", parts[2] if len(parts) > 2 else "en"))
    return out


def fish_voice(language: str, gender: str = "female") -> str:
    lang = language.split("-")[0].lower()
    pool = _pool()
    for want_gender in (gender, "neutral", None):
        for vid, g, accent in pool:
            if accent == lang and (want_gender is None or g == want_gender):
                return vid
    if lang == "en":
        for vid, g, accent in pool:
            if accent == "en-in" and g == gender:
                return vid
    return settings.FISH_AUDIO_VOICE_ID


async def _fish(text: str, language: str) -> bytes:
    body = {"text": text, "format": "mp3", "mp3_bitrate": 192, "normalize": True, "latency": "normal"}
    vid = fish_voice(language)
    if vid:
        body["reference_id"] = vid
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        res = await client.post(settings.FISH_AUDIO_BASE_URL.rstrip("/") + "/v1/tts", json=body, headers={
            "Authorization": f"Bearer {settings.TTS_API_KEY}", "Content-Type": "application/json",
            "model": settings.TTS_MODEL})
    if res.status_code != 200 or len(res.content) < 512:
        raise ProviderError("fish", "failed" if res.status_code < 500 else "transient",
                            f"Fish Audio HTTP {res.status_code}")
    return res.content


async def _fal(text: str) -> bytes:
    headers = {"Authorization": f"Key {settings.FAL_KEY}", "Content-Type": "application/json"}
    base = settings.FAL_QUEUE_URL.rstrip("/")
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        res = await client.post(f"{base}/{settings.FAL_TTS_MODEL}", headers=headers, json={"text": text, "voice": "Sarah"})
        if res.status_code not in (200, 201, 202):
            raise ProviderError("fal", "failed", f"fal HTTP {res.status_code}")
        job = res.json()
        url = ""
        for _ in range(90):
            st = await client.get(job["status_url"], headers=headers)
            status = (st.json() or {}).get("status", "") if st.status_code == 200 else ""
            if status == "COMPLETED":
                out = await client.get(job["response_url"], headers=headers)
                url = str(((out.json() or {}).get("audio") or {}).get("url") or "")
                break
            if status in ("FAILED", "ERROR", "CANCELLED"):
                raise ProviderError("fal", "failed", f"fal job {status.lower()}")
            await asyncio.sleep(2)
        if not url:
            raise ProviderError("fal", "failed", "fal returned no audio")
    from ..security import fetch_media
    data, _ = await fetch_media(url, 20_000_000, expected=("audio/",))
    return data


async def speak(text: str, language: str) -> tuple[bytes, str]:
    """Returns (mp3 bytes, provider). Raises ProviderError when nobody can."""
    text = (text or "").strip()
    if not text:
        raise ProviderError("tts", "invalid_input", "nothing to say")
    from . import sarvam
    steps = []
    if settings.TTS_API_KEY:
        steps.append(("fish", lambda: _fish(text, language)))
    if settings.FAL_KEY:
        steps.append(("fal", lambda: _fal(text)))
    if language.startswith("en"):
        steps.reverse()
    elif sarvam.configured():
        # Indian languages lead with Sarvam Bulbul (native Hindi/Bengali voices).
        steps.insert(0, ("sarvam", lambda: sarvam.tts(text, language)))
    if settings.TTS_PROVIDER in ("fish", "fal", "sarvam"):
        steps = [s for s in steps if s[0] == settings.TTS_PROVIDER]
    errors = []
    for name, run in steps:
        try:
            return await run(), name
        except (ProviderError, httpx.HTTPError) as e:
            errors.append(f"{name}: {e}")
            log.warning("narration via %s failed: %s", name, e)
    raise ProviderError("tts", "not_configured" if not steps else "failed", "; ".join(errors) or "no TTS configured")


def chars_cost_unit(provider: str) -> tuple[str, str]:
    return {"fish": ("fish", settings.TTS_MODEL), "sarvam": ("sarvam", settings.SARVAM_TTS_MODEL)}.get(
        provider, ("fal", settings.FAL_TTS_MODEL))
