"""OpenRouter image generation, used only as a fallback after NanoGPT's two
keys. Images come back as base64 data URLs in message.images. Two accounts
are tried in order; a rejected or empty account passes to the next.

  POST {base}/chat/completions {model, messages, modalities: ["image","text"], image_config: {aspect_ratio}}
"""
from __future__ import annotations

import base64

from ..config import settings
from .base import ProviderError, request

PROVIDER = "openrouter"


def keys() -> list[tuple[str, str]]:
    out = []
    for slot, k in (("primary", settings.OPENROUTER_API_KEY), ("fallback", settings.OPENROUTER_FALLBACK_API_KEY)):
        if k and k not in [x[1] for x in out]:
            out.append((slot, k))
    return out


def configured() -> bool:
    return bool(keys())


async def generate(prompt: str, *, aspect_ratio: str = "1:1", reference: str | None = None) -> dict:
    content: list = [{"type": "text", "text": prompt}]
    if reference:
        content.append({"type": "image_url", "image_url": {"url": reference}})
    body = {"model": settings.OPENROUTER_IMAGE_MODEL, "messages": [{"role": "user", "content": content}],
            "modalities": ["image", "text"], "image_config": {"aspect_ratio": aspect_ratio}}
    last: ProviderError | None = None
    for slot, k in keys():
        headers = {"Authorization": f"Bearer {k}", "Content-Type": "application/json",
                   "HTTP-Referer": settings.APP_BASE_URL, "X-Title": settings.APP_NAME}
        try:
            resp = await request(PROVIDER, "POST", settings.OPENROUTER_BASE_URL.rstrip("/") + "/chat/completions",
                                 headers=headers, json=body, timeout=180, attempts=2, paid=True)
        except ProviderError as e:
            last = e
            if e.kind in ("auth", "failed") or e.status == 402:
                continue  # rejected key or no credit on this account: try the next one
            raise
        data = resp.json() or {}
        msg = ((data.get("choices") or [{}])[0]).get("message") or {}
        imgs = msg.get("images") or []
        url = ((imgs[0] or {}).get("image_url") or {}).get("url") if imgs else None
        if not url or not url.startswith("data:"):
            last = ProviderError(PROVIDER, "failed", "OpenRouter returned no image")
            continue
        head, b64 = url.split(",", 1)
        raw = base64.b64decode(b64)
        mime = head[5:].split(";")[0] or "image/png"
        cost = (data.get("usage") or {}).get("cost")
        from decimal import Decimal
        return {"bytes": raw, "mime": mime, "cost_usd": Decimal(str(cost)).quantize(Decimal("0.000001")) if cost is not None else None,
                "model": settings.OPENROUTER_IMAGE_MODEL, "provider": "openrouter", "key_slot": slot}
    raise last or ProviderError(PROVIDER, "not_configured", "No OpenRouter key is configured")
