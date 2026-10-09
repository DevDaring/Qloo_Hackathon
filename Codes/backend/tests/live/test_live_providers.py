"""Live provider checks. Skipped unless LAUNCHLENS_LIVE=1, so offline test
results are never confused with live verification. Only free/read-only calls
are made here (model listings, a tiny reasoning probe, geocoding)."""
from __future__ import annotations

import os

import pytest

pytestmark = pytest.mark.skipif(os.environ.get("LAUNCHLENS_LIVE") != "1", reason="set LAUNCHLENS_LIVE=1 for live checks")


async def test_xai_models_listed():
    from launchlens.config import settings
    from launchlens.providers import xai
    r = await xai.probe()
    assert r["authorized"], r
    assert settings.XAI_IMAGE_MODEL in r["available_models"]["image"]
    assert settings.XAI_VIDEO_MODEL in r["available_models"]["video"]


async def test_reasoning_structured_and_vision():
    from launchlens.providers import llm
    r = await llm.probe()
    assert r["operations"].get("structured_output") == "supported", r


async def test_geocoding_live():
    from launchlens.providers import geo
    res, _ = await geo.geocode("Kolkata", "in", 1)
    assert res and abs(res[0]["lat"] - 22.57) < 0.5


async def test_qloo_live():
    from launchlens.providers import qloo
    if not qloo.configured():
        pytest.skip("QLOO_API_KEY not configured: live Qloo verification is BLOCKED")
    r = await qloo.probe()
    assert r["authorized"] and r["operations"].get("search") in ("supported", "reachable_no_results"), r


async def test_sarvam_translation_protects_brand():
    from launchlens.providers import sarvam
    if not sarvam.configured():
        pytest.skip("SARVAM_API_KEY not configured")
    out = await sarvam.translate("Stay cool with Breeze IoT Chair.", "bn", protect=["Breeze IoT Chair"])
    assert "Breeze IoT Chair" in out and any("ঀ" <= ch <= "৿" for ch in out)
