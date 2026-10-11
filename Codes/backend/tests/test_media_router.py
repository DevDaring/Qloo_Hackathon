"""NanoGPT primary/fallback keys and the direct-xAI last resort (no network)."""
from __future__ import annotations

import base64
from types import SimpleNamespace

import pytest

from launchlens.config import settings
from launchlens.providers import media, nanogpt, xai
from launchlens.providers.base import ProviderError

PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 32).decode()


@pytest.fixture
def keys(monkeypatch):
    monkeypatch.setattr(settings, "NANOGPT_API_KEY", "sk-nano-primary")
    monkeypatch.setattr(settings, "NANOGPT_FALLBACK_API_KEY", "sk-nano-fallback")
    monkeypatch.setattr(settings, "MEDIA_PROVIDER", "nanogpt")
    monkeypatch.setattr(settings, "MEDIA_IMAGE_CHAIN", "nanogpt,openrouter,xai")
    monkeypatch.setattr(settings, "MEDIA_VIDEO_CHAIN", "nanogpt,xai")
    calls = []
    return calls


def fake_request(calls, rejected=(), fail_kind=None):
    async def request(provider, method, url, *, headers=None, json=None, params=None, **kw):
        key = headers["x-api-key"]
        calls.append((url.rsplit("/", 1)[-1], key, json))
        if key in rejected:
            raise ProviderError("nanogpt", "auth", "credential rejected (HTTP 401)", status=401)
        if fail_kind:
            raise ProviderError("nanogpt", fail_kind, "refused", status=400)
        if url.endswith("/video/status"):
            return SimpleNamespace(json=lambda: {"data": {"status": "COMPLETED", "output": {"video": {"url": "https://v"}},
                                                          "cost": 0.3}})
        return SimpleNamespace(json=lambda: {"data": [{"b64_json": PNG}], "cost": 0.02})
    return request


async def test_primary_key_used_first(keys, monkeypatch):
    monkeypatch.setattr(nanogpt, "request", fake_request(keys))
    res = await media.generate_image("a street", aspect_ratio="9:16")
    assert res["provider"] == "nanogpt" and res["key_slot"] == "primary" and str(res["cost_usd"]) == "0.020000"
    assert [k for _, k, _ in keys] == ["sk-nano-primary"]
    assert keys[0][2]["size"] == "9:16" and keys[0][2]["model"] == "grok-imagine-image"


async def test_rejected_primary_falls_back_to_second_key(keys, monkeypatch):
    monkeypatch.setattr(nanogpt, "request", fake_request(keys, rejected=("sk-nano-primary",)))
    res = await media.generate_image("a street")
    assert res["key_slot"] == "fallback" and [k for _, k, _ in keys] == ["sk-nano-primary", "sk-nano-fallback"]


async def test_content_refusal_is_not_retried_elsewhere(keys, monkeypatch):
    monkeypatch.setattr(nanogpt, "request", fake_request(keys, fail_kind="policy_refusal"))
    monkeypatch.setattr(xai, "configured", lambda: True)
    with pytest.raises(ProviderError) as e:
        await media.generate_image("a street")
    assert e.value.kind == "policy_refusal" and len(keys) == 1  # no second key, no xAI


async def test_both_keys_rejected_falls_through_the_chain(keys, monkeypatch):
    from launchlens.providers import openrouter_image
    monkeypatch.setattr(nanogpt, "request", fake_request(keys, rejected=("sk-nano-primary", "sk-nano-fallback")))
    monkeypatch.setattr(openrouter_image, "configured", lambda: False)
    monkeypatch.setattr(xai, "configured", lambda: True)

    async def xai_image(prompt, aspect_ratio="1:1", **kw):
        return {"bytes": b"x", "mime": "image/png", "cost_usd": None, "model": "grok-imagine-image"}
    monkeypatch.setattr(xai, "generate_image", xai_image)
    assert (await media.generate_image("a street"))["provider"] == "xai"
    monkeypatch.setattr(settings, "MEDIA_IMAGE_CHAIN", "nanogpt")  # nothing after NanoGPT: the error surfaces
    with pytest.raises(ProviderError) as e:
        await media.generate_image("a street")
    assert e.value.kind == "auth"


async def test_owner_order_xai_first_then_nanogpt_for_video(keys, monkeypatch):
    monkeypatch.setattr(settings, "MEDIA_VIDEO_CHAIN", "xai,nanogpt")
    monkeypatch.setattr(xai, "configured", lambda: True)
    calls = []

    async def xai_start(body):
        calls.append("xai")
        raise ProviderError("xai", "auth", "Your team has used all available credits", status=403)
    monkeypatch.setattr(xai, "start_video", xai_start)

    async def nano_start(body):
        calls.append("nanogpt")
        return "vid_123"
    monkeypatch.setattr(nanogpt, "start_video", nano_start)
    assert media.primary("video") == "xai"
    rid, who, _m = await media.start_video("pan", 5, "9:16", image_ref="data:image/jpeg;base64,AAAA")
    assert (rid, who) == ("vid_123", "nanogpt") and calls == ["xai", "nanogpt"]

    async def xai_unknown(body):
        raise ProviderError("xai", "submission_unknown", "sent, no response")
    monkeypatch.setattr(xai, "start_video", xai_unknown)
    with pytest.raises(ProviderError):  # an ambiguous submission is never resubmitted elsewhere
        await media.start_video("pan", 5, "9:16", image_ref="data:image/jpeg;base64,AAAA")


async def test_video_ids_route_polling_to_their_provider(keys, monkeypatch):
    monkeypatch.setattr(nanogpt, "request", fake_request(keys))

    async def xai_poll(rid):
        return {"state": "pending", "error": None, "who": "xai"}
    monkeypatch.setattr(xai, "poll_video", xai_poll)
    st = await media.poll_video("vid_abc123")
    assert st["state"] == "done" and st["url"] == "https://v"
    assert (await media.poll_video("0d6c1f3e-xai-uuid"))["who"] == "xai"


def test_video_body_uses_nanogpt_fields():
    b = nanogpt.video_body("pan", 20, "9:16", image_ref="data:image/jpeg;base64,AAAA")
    assert b["duration"] == "15" and b["imageDataUrl"].startswith("data:") and "image" not in b
    with pytest.raises(ProviderError):
        nanogpt.video_body("pan", 5, "9:16", image_ref="https://remote/img.jpg")


async def test_openrouter_image_is_tried_after_both_nanogpt_keys(keys, monkeypatch):
    from launchlens.providers import openrouter_image
    monkeypatch.setattr(nanogpt, "request", fake_request(keys, rejected=("sk-nano-primary", "sk-nano-fallback")))
    monkeypatch.setattr(openrouter_image, "configured", lambda: True)

    async def or_gen(prompt, aspect_ratio="1:1", reference=None):
        return {"bytes": b"x", "mime": "image/png", "cost_usd": None, "model": "google/gemini-2.5-flash-image",
                "provider": "openrouter", "key_slot": "primary"}
    monkeypatch.setattr(openrouter_image, "generate", or_gen)
    res = await media.generate_image("a street")
    assert res["provider"] == "openrouter" and len(keys) == 2  # both NanoGPT keys were tried first


def test_reasoning_chain_order_and_dedup(monkeypatch):
    from launchlens.providers import llm
    for k, v in {"LLM_PRIMARY_PROVIDER": "nanogpt", "NANOGPT_API_KEY": "a", "NANOGPT_FALLBACK_API_KEY": "b",
                 "OPENROUTER_API_KEY": "c", "OPENROUTER_FALLBACK_API_KEY": "c", "LLM_ALLOW_FALLBACK": True,
                 "LLM_FALLBACK_PROVIDER": "xai", "XAI_API_KEY": "d"}.items():
        monkeypatch.setattr(settings, k, v)
    assert [p[0] for p in llm._providers()] == ["nanogpt", "nanogpt_backup", "openrouter", "xai"]  # duplicate key skipped
