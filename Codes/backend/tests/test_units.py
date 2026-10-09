"""Unit tests: scoring, evidence rules, claims, hashing, security, typography."""
from __future__ import annotations

import pytest
from PIL import Image, ImageFont

from launchlens.errors import AppError
from launchlens.services import claims, hashing, scoring
from launchlens.services.compose import PRESETS, Copy, MixedFont, compose, runs


def cand(aid, **raw):
    c = scoring.Candidate(area_id=aid, name=aid, country_code="IN", lat=0, lon=0)
    c.raw.update(raw)
    c.hard.append({"name": "Country", "result": "pass", "reason": ""})
    return c


# ---------------------------------------------------------------- scoring ----
def test_rank_transform_ties_and_single():
    assert scoring.rank_transform({"a": 1, "b": 1, "c": 3}) == {"a": 0.25, "b": 0.25, "c": 1.0}
    assert scoring.rank_transform({"a": 5, "b": None}) == {"a": 0.5, "b": None}
    assert scoring.rank_transform({"a": 1, "b": 2}, higher_is_better=False) == {"a": 1.0, "b": 0.0}


def test_hard_constraint_beats_affinity():
    """Acceptance 4: a high-affinity location outside service coverage is excluded."""
    full = dict(partner_access=5, venue_access=5, feature_relevance=50, competitive_room=1)
    a = cand("in_service", cultural_fit=0.2, **full)
    b = cand("out_of_service", cultural_fit=0.99, **full)
    b.hard.append({"name": "Service coverage", "result": "fail", "reason": "outside"})
    res = {r["area_id"]: r for r in scoring.score([a, b])}
    assert res["out_of_service"]["eligible"] is False and res["out_of_service"]["status"] == "excluded"
    assert res["out_of_service"]["rank"] is None
    assert res["in_service"]["rank"] == 1


def test_missing_component_is_incomplete_not_renormalised():
    a = cand("a", partner_access=5, venue_access=2, feature_relevance=60, competitive_room=1)
    b = cand("b", partner_access=1, venue_access=1, feature_relevance=40, competitive_room=3)
    res = {r["area_id"]: r for r in scoring.score([a, b])}
    for r in res.values():
        assert r["status"] == "incomplete"
        assert r["available_weight"] == pytest.approx(0.7)
        assert r["rank"] is None  # incomplete results are not ranked against complete ones
        assert r["components"]["cultural_fit"]["state"] == "missing"
    # index is the sum over available components only: never divided by 0.7
    assert res["a"]["planning_index"] == pytest.approx(0.7)
    assert res["a"]["practical_rank"] == 1


def test_qloo_disabled_state_is_labelled():
    a = cand("a", partner_access=1, venue_access=1, feature_relevance=1, competitive_room=1)
    r = scoring.score([a], qloo_enabled=False)[0]
    assert r["components"]["cultural_fit"]["state"] == "disabled_by_experiment"


def test_budget_scenario_sums_exactly():
    s = scoring.budget_scenario(60000, "INR", [{"name": "A", "channel_type": "physical_venue"},
                                               {"name": "B", "channel_type": "partner_business"},
                                               {"name": "D", "channel_type": "digital_geo"}])
    assert round(sum(x["amount"] for x in s["lines"]), 2) == 60000
    assert scoring.budget_scenario(None, "INR", [])["status"] == "no_budget"


# ---------------------------------------------------------------- claims -----
KW = dict(approved_claims=["A built-in seat-back fan you can switch on while seated."],
          enabled_features=["fan"], disabled_features=["speech_amplification"])


def test_noise_figure_cannot_appear():
    """Acceptance 3: missing noise data cannot become a decibel claim."""
    issues = claims.check("Be heard over 85 dB of street noise", **KW)
    assert any("Noise" in i["reason"] for i in issues)


@pytest.mark.parametrize("text", ["Clinically proven comfort", "ISO 9001 certified chair", "2-year warranty included",
                                  "Tender eligible for hospitals", "GPS tracking and emergency alerts", "The best chair"])
def test_unsupported_claims_flagged(text):
    assert claims.check(text, **KW)


def test_removed_feature_terms_flagged_and_approved_claim_allowed():
    assert claims.check("Speech amplification so you are heard", **KW)
    assert not claims.check("A built-in seat-back fan you can switch on while seated.", **KW)


# ---------------------------------------------------------------- hashing ----
def test_copy_edit_changes_only_copy_hash():
    """Acceptance 13: a caption edit must not invalidate visuals/research."""
    a = {"headline": "H", "body": "B", "cta": "C", "setting": "street", "visual_direction": "warm"}
    b = {**a, "headline": "H2"}
    assert hashing.copy_hash(a) != hashing.copy_hash(b)
    assert hashing.visual_hash(a) == hashing.visual_hash(b)
    c = {**a, "setting": "park"}
    assert hashing.visual_hash(a) != hashing.visual_hash(c)


def test_identity_hash_distinguishes_audiences():
    x = hashing.identity_hash("p", "a", "aud1", "en", "social", "o", "fan")
    y = hashing.identity_hash("p", "a", "aud2", "en", "social", "o", "fan")
    assert x != y


# ---------------------------------------------------------------- security ---
def test_redaction_and_ssrf_and_storage_keys():
    from launchlens.config import settings
    from launchlens.security import redact, validate_public_url
    from launchlens.storage import LocalStorage
    secret = settings.AUTH_SECRET
    assert secret not in redact(f"token={secret} and {secret}")
    assert "[REDACTED]" in redact("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123")
    for bad in ("http://example.com/x", "https://127.0.0.1/x", "https://localhost/x", "https://10.0.0.5/a"):
        with pytest.raises(AppError):
            validate_public_url(bad)
    st = LocalStorage(settings.LOCAL_ASSET_DIR)
    for key in ("../etc/passwd", "/abs/path", "ws/../../x"):
        with pytest.raises(ValueError):
            st.path(key)


# ---------------------------------------------------------------- typography -
def _render(f: ImageFont.FreeTypeFont, ch: str) -> bytes:
    from PIL import ImageDraw
    im = Image.new("L", (160, 160))
    ImageDraw.Draw(im).text((20, 20), ch, font=f, fill=255)
    return im.tobytes()


@pytest.mark.parametrize("text", ["চলার পথে Breeze IoT Chair আরামে।", "गर्मी में आराम Breeze IoT Chair के साथ।"])
def test_indic_and_mixed_scripts_have_glyphs(text):
    """Acceptance 17: every character is drawn with a font that has its glyph."""
    mf = MixedFont("Bold", 48)
    for script, chunk in runs(text):
        f = mf.f(script)
        tofu = _render(f, "\U0010FFFD")
        for ch in chunk:
            if ch.isspace():
                continue
            assert _render(f, ch) != tofu, f"missing glyph {ch!r} in {script} font"


def test_compose_presets_and_quality():
    bg = Image.new("RGB", (800, 800), (40, 80, 120))
    prod = Image.new("RGB", (600, 400), (255, 255, 255))
    prod.paste((20, 20, 20), (150, 100, 450, 300))
    for preset in ("square", "portrait", "vertical"):
        img, layout, q = compose(bg, prod, Copy("গরমে আরাম, Breeze IoT Chair", "A built-in seat-back fan.", "Book a demo",
                                                "₹85,000", "", "bn"), preset)
        assert img.size == PRESETS[preset]["size"]
        assert q["dimensions"]["ok"] and q["product"]["aspect_preserved"] and q["safe_area_ok"]
        assert q["passed"], q
        assert layout["background_crop"]["source_size"] == [800, 800]
