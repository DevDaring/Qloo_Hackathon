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


def test_swapped_city_evidence_is_detected():
    """P0: practical equality must be checked per city, not as a bag of values."""
    from launchlens.services.experiments import compare_fingerprints, kendall_tau
    a = {"k": {"climate|observed_fact": "h1"}, "d": {"climate|observed_fact": "h2"}}
    swapped = {"k": {"climate|observed_fact": "h2"}, "d": {"climate|observed_fact": "h1"}}
    assert compare_fingerprints(a, a, {}) == []
    assert len(compare_fingerprints(a, swapped, {"k": "Kolkata", "d": "Delhi"})) == 2
    assert kendall_tau(["a", "b", "c"], ["a", "b", "c"]) == 1.0
    assert kendall_tau(["a", "b", "c"], ["c", "b", "a"]) == -1.0
    assert kendall_tau(["a"], ["a"]) is None


def test_finite_metrics_and_explanations():
    from launchlens.providers.qloo import _entity, finite
    assert finite("nan") is None and finite(float("inf")) is None and finite("0.5") == 0.5
    e = _entity({"entity_id": "X", "name": "n", "query": {"affinity": "nan", "explainability": {
        "signal.interests.entities": [{"entity_id": "E1", "score": 1}]}}})
    assert e["affinity"] is None
    assert e["explanation"] == {"status": "provided", "contributions": [{"signal": "signal.interests.entities", "id": "E1", "score": 1.0}]}
    assert _entity({"entity_id": "Y", "query": {}})["explanation"]["status"] == "not_provided"


def test_plain_status_has_no_config_names_and_reports_backup():
    from launchlens.services import plainstatus
    data = {"qloo": {"configured": True, "reachable": True, "authorized": True, "checked_at": "t",
                     "operations": {"search": "supported", "heatmap": "no_usable_data"}},
            "reasoning": {"configured": True, "reachable": True, "authorized": True, "model": "gpt-4.1-mini",
                          "served_by": "grok-4.20", "operations": {"structured_output": "supported"}},
            "media": {"configured": False}, "narration": {"configured": True}, "indic_language": {"configured": True},
            "geo": {"geocoding": {"reachable": True}}}
    out = {x["key"]: x for x in plainstatus.build(data, "now")}
    assert out["qloo"]["state"] == "partial" and "taste heatmap" in out["qloo"]["impact"]
    assert out["reasoning"]["state"] == "backup" and "grok" in out["reasoning"]["summary"]
    assert out["media"]["state"] == "not_set_up" and out["media"]["recovery"]
    text = str(out)
    assert "API_KEY" not in text and "_KEY" not in text and "env" not in text.lower()


def test_category_profiles_are_consistent():
    from launchlens.services import profiles
    assert profiles.for_product({"category": "power wheelchair"}).key == "mobility"
    assert profiles.for_product({"category": "portable speaker"}).key == "audio"
    for p in profiles.PROFILES.values():
        cats = {c for _, c, _, _ in p.osm} | {c for c, _ in p.qloo_tags.values()}
        assert len(profiles.osm_tag_index(p)) == len(p.osm)  # every selector parses
        for role, fit in p.role_fit.items():
            assert set(fit) <= cats, (p.key, role, set(fit) - cats)
        assert set(p.activation) <= cats
        assert {ch for ch, _ in p.activation.values()} | {"digital_geo"} <= set(p.next_action)
    from launchlens.services.creative import angle_text, feature_angle
    assert feature_angle("fan") == "fan_comfort" and feature_angle("party_sync") == "lead_party_sync"
    prod = {"features": [{"key": "party_sync", "name": "Party sync", "proposed_benefit": "link speakers", "enabled": True},
                         {"key": "splash_resistant", "name": "Splash resistant", "proposed_benefit": "x", "enabled": True}]}
    assert "Party sync" in angle_text("lead_party_sync", prod) and "Splash resistant" in angle_text("lead_party_sync", prod)


def test_small_product_on_large_canvas_is_cut_out_and_failures_keep_the_photo():
    import numpy as np
    from PIL import Image, ImageDraw

    from launchlens.services.compose import cutout
    im = Image.new("RGB", (1000, 1000), (250, 250, 250))
    ImageDraw.Draw(im).rounded_rectangle([430, 330, 570, 700], 30, fill=(20, 40, 110))  # ~5% of the canvas
    out, info = cutout(im)
    assert info["reliable"] and out.size[0] < 200 and out.size[1] < 400
    assert np.array(out)[:, :, 3].max() == 255
    noisy = Image.fromarray((np.random.default_rng(0).random((300, 300, 3)) * 255).astype("uint8"))
    out2, info2 = cutout(noisy)
    assert not info2["reliable"] and np.array(out2)[:, :, :3].mean() > 60  # never a blacked-out photo


def test_overlong_strings_are_trimmed_only_as_last_resort():
    from pydantic import BaseModel, Field, ValidationError

    from launchlens.providers.llm import _trim_overlong

    class M(BaseModel):
        cta: str = Field(max_length=20)
        n: int
    bad = {"cta": "Discover the fun that lasts all summer", "n": 1}
    try:
        M.model_validate(bad)
    except ValidationError as e:
        fixed = _trim_overlong(bad, e)
    assert fixed["cta"] == "Discover the fun" and M.model_validate(fixed)
    try:
        M.model_validate({"cta": "x" * 30, "n": "not a number"})
    except ValidationError as e:
        assert _trim_overlong({"cta": "x" * 30, "n": "not a number"}, e) is None  # other errors still fail
