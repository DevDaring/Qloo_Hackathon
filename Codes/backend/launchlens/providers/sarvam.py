"""Sarvam AI adapter for Indian languages: translation (Mayura) and narration
(Bulbul). Verified against the account on 2026-10-08:

  POST https://api.sarvam.ai/translate       {input, source_language_code, target_language_code, model, mode}
  POST https://api.sarvam.ai/text-to-speech  {text, language_code, model:"bulbul:v3", speaker, output_audio_codec}
  Auth: `api-subscription-key` header. bulbul:v2 is deprecated (400), v3 works.

Brand and product names are protected with `#n#` placeholders, which Mayura
passes through unchanged (verified for hi-IN and bn-IN); without them it
transliterates or drops "Breeze IoT Chair". A field whose placeholder does not
survive is reported so the caller can fall back to another translator.
"""
from __future__ import annotations

import base64
import re

from ..config import settings
from .base import ProviderError, request

PROVIDER = "sarvam"
LANG = {"hi": "hi-IN", "bn": "bn-IN", "en": "en-IN"}


def configured() -> bool:
    return bool(settings.SARVAM_API_KEY)


def _headers() -> dict:
    if not configured():
        raise ProviderError(PROVIDER, "not_configured", "SARVAM_API_KEY is not set")
    return {"api-subscription-key": settings.SARVAM_API_KEY, "Content-Type": "application/json"}


_lock = None
_last = 0.0


async def _post(path: str, body: dict) -> dict:
    """Sarvam rate-limits bursts: calls are paced (>= 0.6 s apart per process)
    and a 429 is retried with a longer backoff."""
    import asyncio
    import time
    global _lock, _last
    _lock = _lock or asyncio.Lock()
    async with _lock:
        wait = 0.6 - (time.monotonic() - _last)
        if wait > 0:
            await asyncio.sleep(wait)
        for attempt in range(4):
            try:
                resp = await request(PROVIDER, "POST", settings.SARVAM_BASE_URL.rstrip("/") + path, headers=_headers(),
                                     json=body, timeout=60, attempts=1)
                break
            except ProviderError as e:
                if e.kind != "rate_limited" or attempt == 3:
                    raise
                await asyncio.sleep(e.retry_after or 3 * (attempt + 1))
        _last = time.monotonic()
    return resp.json()


async def translate(text: str, target: str, *, protect: list[str] | None = None, source: str = "en") -> str:
    """Translate one field; protected terms come back verbatim (Latin script)."""
    if not text.strip():
        return text
    terms = sorted({t for t in (protect or []) if t and t in text}, key=len, reverse=True)
    masked = text
    for i, t in enumerate(terms, 1):
        masked = masked.replace(t, f"#{i}#")
    data = await _post("/translate", {"input": masked[:1000], "source_language_code": LANG[source],
                                      "target_language_code": LANG[target], "model": settings.SARVAM_TRANSLATE_MODEL,
                                      "mode": "formal"})
    out = data.get("translated_text") or ""
    for i, t in enumerate(terms, 1):
        if f"#{i}#" not in out:
            raise ProviderError(PROVIDER, "failed", f"protected term '{t}' was not preserved")
        out = out.replace(f"#{i}#", t)
    if re.search(r"#\d+#", out):
        raise ProviderError(PROVIDER, "failed", "translation left placeholder tokens")
    return out


async def tts(text: str, language: str) -> bytes:
    lang = language.split("-")[0]
    if lang not in LANG:
        raise ProviderError(PROVIDER, "unsupported", f"Sarvam TTS does not support '{language}'")
    speaker = {"bn": settings.SARVAM_SPEAKER_BN, "hi": settings.SARVAM_SPEAKER_HI}.get(lang, settings.SARVAM_SPEAKER_EN)
    data = await _post("/text-to-speech", {"text": text[:2500], "language_code": LANG[lang],
                                           "model": settings.SARVAM_TTS_MODEL, "speaker": speaker,
                                           "output_audio_codec": "mp3", "speech_sample_rate": 24000})
    audios = data.get("audios") or []
    if not audios:
        raise ProviderError(PROVIDER, "failed", "Sarvam returned no audio")
    raw = base64.b64decode(audios[0])
    if len(raw) < 512:
        raise ProviderError(PROVIDER, "failed", "Sarvam audio was empty")
    return raw
