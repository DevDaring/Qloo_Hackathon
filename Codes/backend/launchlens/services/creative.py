"""Creative planner: versioned, audience-specific briefs and storyboards.

Copy is written in English from the strategy, then translated to Hindi or
Bengali when the user selects that language (never guessed from location).
Machine translations carry review status until a person approves them.
Every material creative decision records the evidence it rests on; styles
inferred by the model are labelled creative hypotheses, never Qloo facts.
"""
from __future__ import annotations

import logging
import re
import uuid
from decimal import Decimal

from pydantic import BaseModel, Field
from sqlalchemy import select

from ..config import settings
from ..db import session_scope
from ..models import CreativeBrief, EvidenceRecord, GeographicArea, Storyboard, StoryboardScene, StrategyVersion
from ..providers import llm
from ..providers.base import ProviderError
from . import claims as claimcheck
from . import costs, hashing
from .cache import stable_hash

log = logging.getLogger("launchlens.creative")
LANG_NAMES = {"en": "English", "hi": "Hindi", "bn": "Bengali"}
CHANNEL_ASPECTS = {"social": ["square", "portrait", "vertical"], "print": ["portrait"], "stories": ["vertical"]}


class Decision(BaseModel):
    decision: str
    rationale: str
    evidence_ids: list[str] = Field(default_factory=list)
    kind: str = Field(description="'evidence' if it rests on cited evidence, else 'creative_hypothesis'")


class SceneDraft(BaseModel):
    purpose: str
    shot_description: str = Field(description="Environment and motion only. Never depict the product, a wheelchair, "
                                               "a mobility device, a fan, a microphone or any text.")
    duration_s: int = Field(ge=3, le=8)
    spoken_copy: str
    on_screen_text: str
    product_overlay: bool = False


class BriefDraft(BaseModel):
    message_hierarchy: list[str]
    headline: str = Field(max_length=70)
    body: str = Field(max_length=200)
    cta: str = Field(max_length=32)
    disclaimer: str = Field(default="", max_length=120)
    tone: str
    setting: str
    visual_direction: str
    product_treatment: str
    mood: str
    accessibility_requirements: list[str]
    background_prompt: str = Field(description="Prompt for a background scene with clear space for a product cut-out; "
                                               "no product, no wheelchair, no mobility device, no text, no logos.")
    decisions: list[Decision]
    scenes: list[SceneDraft] = Field(min_length=2, max_length=3)


class Translation(BaseModel):
    headline: str
    body: str
    cta: str
    disclaimer: str = ""
    scene_spoken: list[str]
    scene_on_screen: list[str]
    back_translation_headline: str


ANGLES = {
    "fan_comfort": ("Feature-emphasis hypothesis A: the headline, first message and CTA are about the built-in fan on warm "
                    "days ONLY. Speech amplification may appear at most once, briefly, at the end of the body."),
    "speech_presence": ("Feature-emphasis hypothesis B: the headline, first message and CTA are about speech amplification "
                        "(joining conversations in busy places) ONLY. The fan may appear at most once, briefly, at the end of the body."),
    "institutional_brief": "Operational, verified-service brief for institutional buyers.",
    "distributor_intro": "Distributor introduction: product range, demo support, partnership terms to discuss.",
}


def default_angle(role: str, main_feature: str) -> str:
    if role == "institutional_buyer":
        return "institutional_brief"
    if role == "distribution_partner":
        return "distributor_intro"
    return "speech_presence" if main_feature == "speech_amplification" else "fan_comfort"


def _price_text(product: dict, language: str) -> str:
    if product.get("price") is None:
        return ""
    sym = {"INR": "₹", "USD": "$", "EUR": "€"}.get(product.get("currency", "INR"), product.get("currency", "") + " ")
    return f"{sym}{product['price']:,.0f}"


def _template_brief(ctx: dict, sv: StrategyVersion, audience: dict, angle: str) -> BriefDraft:
    p = ctx["product"]
    feats = {f["key"]: f for f in p["features"] if f["enabled"]}
    main = feats.get(sv.content.get("main_feature_key")) or next(iter(feats.values()))
    area = sv.content["selected"]["area_name"]
    cta = {"institutional_brief": "Request a site demo", "distributor_intro": "Discuss partnership"}.get(angle, "Book a free demo")
    return BriefDraft(
        message_hierarchy=[main["name"], sv.content.get("positioning", "")],
        headline=f"{main['name']}, ready for {area}"[:70], body=(main["proposed_benefit"] or p["description"])[:200], cta=cta,
        tone="warm, respectful, practical", setting=f"Everyday {area} streets and community spaces",
        visual_direction="Natural light, real places, generous negative space for the product", product_treatment="Real product photo composited, unaltered",
        mood="confident and calm", accessibility_requirements=["Text contrast ≥ 4.5:1", "Captions on all video", "Plain language"],
        background_prompt=f"A sunlit, uncluttered public space in {area}, India, soft afternoon light, wide empty foreground for a product, photographic, no people in the foreground, no text",
        decisions=[Decision(decision=f"Lead with {main['name']}", rationale="From the strategy's main feature", evidence_ids=[], kind="creative_hypothesis")],
        scenes=[SceneDraft(purpose="Set the place", shot_description=f"Slow pan across a warm afternoon street in {area}", duration_s=5,
                           spoken_copy=f"Afternoons in {area} can be long and warm.", on_screen_text=f"Made for {area}"),
                SceneDraft(purpose="Introduce the product", shot_description="Gentle push-in on an open, shaded community courtyard", duration_s=5,
                           spoken_copy=f"Meet {p['name']}.", on_screen_text=main["name"], product_overlay=True),
                SceneDraft(purpose="Invite action", shot_description="Calm wide shot of a community centre entrance at golden hour", duration_s=5,
                           spoken_copy=cta + ".", on_screen_text=cta)])


async def create_brief(ctx: dict, strategy_version_id: uuid.UUID, *, language: str = "en", channel: str = "social",
                       objective: str = "inquiries", angle: str | None = None, workspace_id: uuid.UUID,
                       source_brief: CreativeBrief | None = None) -> dict:
    project_id = uuid.UUID(ctx["project"]["id"])
    async with session_scope() as s:
        sv = await s.get(StrategyVersion, strategy_version_id)
        area = await s.get(GeographicArea, sv.area_id)
        ev_rows = (await s.execute(select(EvidenceRecord).where(
            EvidenceRecord.id.in_([uuid.UUID(i) for i in (sv.evidence_ids or [])][:40])))).scalars().all() if sv.evidence_ids else []
    ev_alias = {f"E{i}": str(e.id) for i, e in enumerate(ev_rows, 1)}
    ev_lines = "\n".join(f"- E{i} [{e.kind}] {e.title}" for i, e in enumerate(ev_rows, 1))
    audience = next(a for a in ctx["audiences"] if a["id"] == str(sv.audience_version_id)) if any(
        a["id"] == str(sv.audience_version_id) for a in ctx["audiences"]) else None
    if audience is None:
        return {"status": "stale_audience", "message": "The strategy's audience version is no longer current."}
    angle = angle or default_angle(audience["role"], sv.content.get("main_feature_key", ""))
    product = ctx["product"]
    feats = [f for f in product["features"] if f["enabled"]]
    disabled = [f["key"] for f in product["features"] if not f["enabled"]]
    approved = [c["text"] for c in ctx["claims"] if c["approved"]]
    kw = dict(approved_claims=approved, enabled_features=[f["key"] for f in feats], disabled_features=disabled,
              prohibited=[x for f in feats for x in (f.get("prohibited_exaggerations") or [])])
    usage = llm.Usage("openai", "")
    system = ("Write a creative brief for one campaign identity. Audience variants must differ meaningfully in message, "
              "setting and CTA. Use only approved claims and enabled features. Do not invent certifications, tender "
              "eligibility, reimbursement, warranties, clinical benefits, numbers, or noise levels. Portray people "
              "with dignity and never as defined by a condition. Background and scene prompts must never depict the "
              "product, a wheelchair, a mobility device, a fan, a microphone, any controls, text or logos: the real "
              "product photo is composited later. Mark any style choice not backed by cited evidence as "
              "kind='creative_hypothesis'. Follow the CREATIVE ANGLE strictly: different angles must produce clearly "
              "different headlines, settings and calls to action. Describe features plainly; avoid quality adjectives "
              "such as 'clear', 'powerful' or 'perfect' that imply unmeasured performance. Write the copy in English.")
    s_content = sv.content
    user = f"""<data>
PRODUCT: {product['name']}. {product['description']}
ENABLED FEATURES: {[{'key': f['key'], 'name': f['name'], 'benefit': f['proposed_benefit']} for f in feats]}
REMOVED FEATURES (must not be mentioned or implied anywhere): {[f['name'] for f in product['features'] if not f['enabled']] or 'none'}
APPROVED CLAIMS (only these may be asserted): {approved or 'none — describe features factually without performance claims'}
AUDIENCE: {audience['name']} ({audience['role']}): {audience['description']}; needs {audience['needs']}
LOCATION: {area.name}
STRATEGY POSITIONING: {s_content.get('positioning')}
MAIN FEATURE: {s_content.get('main_feature_key')} — {s_content.get('main_feature_rationale')}
KEY MESSAGES: {s_content.get('key_messages')}
CREATIVE ANGLE: {ANGLES.get(angle, angle)}
EVIDENCE (cite aliases in decisions.evidence_ids):
{ev_lines or 'none'}
CHANNEL: {channel}; OBJECTIVE: {objective}
</data>
Return the brief JSON with 3 scenes of 4–6 seconds each (total about 15 s before the end card)."""
    try:
        draft, model = await llm.structured(BriefDraft, system, user, usage=usage, temperature=0.6, max_tokens=3000)
        generator = {"type": "llm", "model": model}
    except ProviderError as e:
        draft, generator = _template_brief(ctx, sv, audience, angle), {"type": "template", "reason": e.message}
    # claim check on copy; one repair round, then blocked phrases are reported, not silently kept
    def _check(d: BriefDraft) -> dict:
        return claimcheck.check_many({"headline": d.headline, "body": d.body, "cta": d.cta,
                                      **{f"scene{i}": sc.spoken_copy + " " + sc.on_screen_text for i, sc in enumerate(d.scenes)}}, **kw)
    issues = _check(draft)
    if issues and generator.get("type") == "llm":
        problems = "; ".join(f"{k}: '{i['term']}' ({i['reason']})" for k, v in issues.items() for i in v)
        try:
            fixed, model2 = await llm.structured(
                BriefDraft, system, user + f"\n\nYour previous draft was:\n{draft.model_dump_json()}\n"
                f"It failed the claim check: {problems}. Return the full brief JSON with those phrases removed or "
                "rewritten; change nothing else.", usage=usage, temperature=0.2, max_tokens=3000)
            if not _check(fixed):
                draft, issues = fixed, {}
                generator = {**generator, "repaired": True}
        except ProviderError:
            pass
    content = draft.model_dump(exclude={"decisions", "scenes"})
    content.update({"price_text": _price_text(product, language), "language": "en",
                    "aspect_ratios": CHANNEL_ASPECTS.get(channel, ["square", "portrait", "vertical"]),
                    "approved_claims_used": approved, "claim_issues": issues, "angle": angle,
                    "references": {"product_asset_ids": [a["asset_id"] for a in ctx["product_assets"] if a["role"] == "product_photo"],
                                   "logo_asset_ids": [a["asset_id"] for a in ctx["product_assets"] if a["role"] == "logo"]},
                    "generator": generator})
    scenes = [sc.model_dump() for sc in draft.scenes]
    translation_status = "source"
    if language != "en":
        try:
            content, scenes = await translate(content, scenes, language, usage,
                                              protect=list({product["name"], re.sub(r"\s*\(.*?\)\s*", " ", product["name"]).strip()}))
            translation_status = "machine_translated_needs_review"
            if content.get("translation_chars"):
                await costs.record(workspace_id=workspace_id, project_id=project_id, provider="sarvam",
                                   model=settings.SARVAM_TRANSLATE_MODEL, operation="translate", category="reasoning",
                                   quantity=content["translation_chars"] / 1000, unit="1k_chars")
        except ProviderError as e:
            return {"status": "failed", "message": f"Translation unavailable: {e.message}"}
    if usage.calls:
        await costs.record(workspace_id=workspace_id, project_id=project_id, provider=usage.provider, model=usage.model,
                           operation="creative_brief", category="reasoning", quantity=usage.input_tokens / 1000,
                           unit="1k_input_tokens", actual_usd=llm.cost_of(usage))
    decisions = [d.model_dump() for d in draft.decisions]
    valid_ev = set(sv.evidence_ids or [])
    for d in decisions:
        d["evidence_ids"] = [ev_alias.get(i.strip().upper(), i) for i in d["evidence_ids"]]
        d["evidence_ids"] = [i for i in d["evidence_ids"] if i in valid_ev]
        if not d["evidence_ids"]:
            d["kind"] = "creative_hypothesis"
    ident = hashing.identity_hash(product["id"], sv.area_id, sv.audience_version_id, language, channel, objective, angle)
    async with session_scope() as s:
        if source_brief is not None:
            lineage, version = source_brief.lineage_id, source_brief.version + 1
            old = await s.get(CreativeBrief, source_brief.id)
            old.is_current = False
        else:
            lineage, version = uuid.uuid4(), 1
        b = CreativeBrief(project_id=project_id, strategy_version_id=sv.id, lineage_id=lineage, version=version,
                          product_version_id=uuid.UUID(product["id"]), area_id=sv.area_id,
                          audience_version_id=sv.audience_version_id, language=language, channel=channel,
                          objective=objective, angle=angle, identity_hash=ident, content=content, decisions=decisions,
                          approval_state="draft", translation_status=translation_status,
                          copy_hash=hashing.copy_hash(content), visual_hash=hashing.visual_hash(content))
        s.add(b)
        await s.flush()
        await _storyboard(s, b, scenes, ctx)
        return {"status": "created", "brief_id": str(b.id), "version": b.version, "claim_issues": issues,
                "translation_status": translation_status}


async def _storyboard(s, b: CreativeBrief, scenes: list[dict], ctx: dict) -> Storyboard:
    product_asset = next((uuid.UUID(a["asset_id"]) for a in ctx["product_assets"] if a["role"] == "product_photo" and a["is_primary"]),
                         next((uuid.UUID(a["asset_id"]) for a in ctx["product_assets"] if a["role"] == "product_photo"), None))
    if scenes and not any(sc.get("product_overlay") for sc in scenes):
        # The real product photo must appear in motion at least once (composited, never generated).
        scenes[min(1, len(scenes) - 1)]["product_overlay"] = True
    total = sum(int(sc["duration_s"]) for sc in scenes) + 3
    sb = Storyboard(brief_id=b.id, version=1, total_seconds=Decimal(total), aspect_ratio="9:16",
                    audio_plan={"default": "silent_captioned", "narration": "optional TTS, needs review"})
    s.add(sb)
    await s.flush()
    for i, sc in enumerate(scenes):
        s.add(StoryboardScene(storyboard_id=sb.id, idx=i, kind="generated", purpose=sc["purpose"],
                              shot_description=sc["shot_description"], duration_s=Decimal(int(sc["duration_s"])),
                              product_reference_asset_id=product_asset if sc.get("product_overlay") else None,
                              spoken_copy=sc["spoken_copy"], on_screen_text=sc["on_screen_text"],
                              input_hash=stable_hash({k: sc.get(k) for k in ("shot_description", "duration_s")})))
    s.add(StoryboardScene(storyboard_id=sb.id, idx=len(scenes), kind="end_card", purpose="Real product, headline and CTA",
                          shot_description="End card composed from the real product photo", duration_s=Decimal(3),
                          product_reference_asset_id=product_asset, spoken_copy="", on_screen_text=b.content["cta"]))
    return sb


async def translate(content: dict, scenes: list[dict], language: str, usage: llm.Usage,
                    protect: list[str] | None = None) -> tuple[dict, list[dict]]:
    """Sarvam (Mayura) first for Hindi/Bengali, field by field with brand names
    protected; any field Sarvam cannot translate faithfully falls back to the
    reasoning model. Either way the result is marked as needing human review."""
    from ..providers import sarvam
    if sarvam.configured():
        try:
            return await _translate_sarvam(content, scenes, language, protect or [])
        except ProviderError as e:
            log.warning("Sarvam translation unavailable, using the reasoning model: %s", e.message)
    return await _translate_llm(content, scenes, language, usage)


async def _translate_sarvam(content: dict, scenes: list[dict], language: str, protect: list[str]):
    from ..providers import sarvam
    fields = {k: content.get(k, "") for k in ("headline", "body", "cta", "disclaimer")}
    for i, sc in enumerate(scenes):
        fields[f"spoken{i}"] = sc.get("spoken_copy", "")
        fields[f"screen{i}"] = sc.get("on_screen_text", "")
    out_fields, fallbacks = {}, []
    for k, v in fields.items():
        try:
            out_fields[k] = await sarvam.translate(v, language, protect=protect)
        except ProviderError as e:
            if e.kind in ("auth", "not_configured"):
                raise
            fallbacks.append(k)
            out_fields[k] = None
    if fallbacks:
        llm_content, llm_scenes = await _translate_llm(content, scenes, language, llm.Usage("openai", ""))
        for k in fallbacks:
            if k.startswith("spoken"):
                out_fields[k] = llm_scenes[int(k[6:])]["spoken_copy"]
            elif k.startswith("screen"):
                out_fields[k] = llm_scenes[int(k[6:])]["on_screen_text"]
            else:
                out_fields[k] = llm_content.get(k, "")
    try:
        back = await sarvam.translate(out_fields["headline"], "en", protect=protect, source=language)
    except ProviderError:
        back = ""
    chars = sum(len(v or "") for v in fields.values()) + len(out_fields["headline"] or "")
    out = dict(content)
    out.update(headline=out_fields["headline"], body=out_fields["body"], cta=out_fields["cta"],
               disclaimer=out_fields["disclaimer"], language=language,
               source_copy={"headline": content["headline"], "body": content["body"], "cta": content["cta"]},
               back_translation={"headline": back},
               translation_model=f"sarvam/{settings.SARVAM_TRANSLATE_MODEL}",
               translation_fallback_fields=fallbacks, translation_chars=chars)
    new_scenes = []
    for i, sc in enumerate(scenes):
        sc = dict(sc)
        sc["spoken_copy"], sc["on_screen_text"] = out_fields[f"spoken{i}"], out_fields[f"screen{i}"]
        new_scenes.append(sc)
    return out, new_scenes


async def _translate_llm(content: dict, scenes: list[dict], language: str, usage: llm.Usage) -> tuple[dict, list[dict]]:
    lang = LANG_NAMES[language]
    system = (f"Translate advertising copy from English into natural, respectful {lang} for India. Keep meaning exact: "
              "do not add claims, numbers or promises. Keep brand and product names in Latin script. Also give an "
              "English back-translation of the headline for review.")
    user = f"""<data>
headline: {content['headline']}
body: {content['body']}
cta: {content['cta']}
disclaimer: {content.get('disclaimer', '')}
scene_spoken: {[sc['spoken_copy'] for sc in scenes]}
scene_on_screen: {[sc['on_screen_text'] for sc in scenes]}
</data>"""
    t, model = await llm.structured(Translation, system, user, usage=usage, temperature=0.2, max_tokens=2000)
    out = dict(content)
    out.update(headline=t.headline, body=t.body, cta=t.cta, disclaimer=t.disclaimer, language=language,
               source_copy={"headline": content["headline"], "body": content["body"], "cta": content["cta"]},
               back_translation={"headline": t.back_translation_headline}, translation_model=model)
    new_scenes = []
    for i, sc in enumerate(scenes):
        sc = dict(sc)
        if i < len(t.scene_spoken):
            sc["spoken_copy"] = t.scene_spoken[i]
        if i < len(t.scene_on_screen):
            sc["on_screen_text"] = t.scene_on_screen[i]
        new_scenes.append(sc)
    return out, new_scenes


async def current_brief(brief_id: uuid.UUID) -> CreativeBrief | None:
    async with session_scope() as s:
        return await s.get(CreativeBrief, brief_id)


async def storyboard_for(brief_id: uuid.UUID) -> Storyboard | None:
    async with session_scope() as s:
        return (await s.execute(select(Storyboard).where(Storyboard.brief_id == brief_id)
                                .order_by(Storyboard.version.desc()).limit(1))).scalar_one_or_none()
