"""Image and video production with exactly-once intent on paid calls.

For every paid request: reserve cost -> write a `prepared` attempt (committed)
-> send -> store the remote id / result (committed) -> settle cost. On a crash
the attempt row tells a restarted worker what happened:
  succeeded + output asset      -> reuse, never pay again
  submitted + remote id (video) -> resume polling
  submission_unknown            -> stop; a person reconciles and retries deliberately
Assets that already succeeded are kept when a sibling fails.
"""
from __future__ import annotations

import asyncio
import io
import logging
import re
import tempfile
import uuid
from pathlib import Path

from PIL import Image
from pydantic import BaseModel
from sqlalchemy import select

from ..config import settings
from ..db import session_scope
from ..models import Asset, CreativeBrief, Job, ProductAsset, Storyboard, StoryboardScene
from ..providers import llm, voice, xai
from ..providers.base import ProviderError
from ..security import fetch_media
from . import assets as assetsvc
from . import claims as claimcheck
from . import compose, costs, events, jobs
from . import video as videosvc
from .cache import stable_hash

log = logging.getLogger("launchlens.production")

# Guards are phrased positively: naming an object, even to forbid it, tends to
# put it in the picture. The vision review below checks the result anyway.
BG_GUARD = (" Photographic background plate. Keep the lower half calm, softly lit and uncluttered for text, with an "
            "open central space. Everyone visible is standing or seated on ordinary chairs, benches or steps. "
            "No equipment, devices, gadgets, signage, text, letters, logos or watermarks.")
SCENE_GUARD = (" Full-frame cinematic photograph filling the entire image edge to edge with natural depth and no blank "
               "areas. Everyone visible is standing or seated on ordinary chairs, benches or steps. No equipment, "
               "devices, gadgets, signage, text, letters, logos or watermarks.")
VIDEO_GUARD = (" Cinematic, gentle natural motion, realistic. Keep the scene exactly as in the reference frame: people stay "
               "on ordinary seats or keep walking; nothing new is added. No equipment, devices, signage, text or logos.")
_RISKY = re.compile(r"wheel ?chair|mobility|scooter|walker|crutch|medical|device|product|fan\b|microphone|speaker", re.I)


def clean_prompt(text: str) -> str:
    """Drop clauses that name excluded objects (model-written prompts often say
    'no wheelchair visible', which tends to produce one)."""
    parts = re.split(r"(?<=[.;,])\s+", text or "")
    return " ".join(p for p in parts if not _RISKY.search(p)).strip()


class JobCtx:
    """What a production step needs from the running job."""

    def __init__(self, job: Job, owner: str):
        self.job, self.owner = job, owner

    async def beat(self, status: str | None = None, **progress) -> None:
        st = await jobs.heartbeat(self.job.id, self.owner, status=status, progress=progress or None)
        if st in ("cancellation_requested", "cancelled", "lost_lease", "missing"):
            raise jobs.Cancelled(st)

    async def emit(self, message: str, stage: str = "", **data) -> None:
        await events.emit(self.job.workspace_id, "job.progress", message, project_id=self.job.project_id,
                          run_id=self.job.run_id, job_id=self.job.id, stage=stage, data=data)


async def _brief_inputs(brief_id: uuid.UUID) -> tuple[CreativeBrief, Asset, Asset | None]:
    async with session_scope() as s:
        b = await s.get(CreativeBrief, brief_id)
        if b is None:
            raise ProviderError("launchlens", "invalid_input", "brief not found")
        pas = (await s.execute(select(ProductAsset).where(ProductAsset.project_id == b.project_id))).scalars().all()
        photo_id = next((p.asset_id for p in pas if p.role == "product_photo" and p.is_primary),
                        next((p.asset_id for p in pas if p.role == "product_photo"), None))
        logo_id = next((p.asset_id for p in pas if p.role == "logo"), None)
        if photo_id is None:
            raise ProviderError("launchlens", "invalid_input", "Upload a product photo before generating ads.")
        photo = await s.get(Asset, photo_id)
        logo = await s.get(Asset, logo_id) if logo_id else None
        return b, photo, logo


async def _open_image(asset: Asset) -> Image.Image:
    return Image.open(io.BytesIO(await assetsvc.load_bytes(asset)))


def _blocking_issues(brief: CreativeBrief) -> dict:
    return {k: v for k, v in (brief.content.get("claim_issues") or {}).items()
            if any(i.get("severity") == "block" for i in v)}


async def paid_image(ctx: JobCtx, *, key: str, prompt: str, aspect: str, kind: str, project_id: uuid.UUID,
                     label: str, lineage: dict, reference: str | None = None, brief_id: uuid.UUID | None = None,
                     identity_hash: str = "", input_hash: str = "") -> Asset:
    """One xAI image under the attempt ledger."""
    prior = await jobs.find_attempt(key)
    if prior and prior.status == "succeeded" and prior.output_asset_ids:
        a = await assetsvc.get(uuid.UUID(prior.output_asset_ids[0]))
        if a:
            return a
    if prior and prior.status in ("submission_unknown", "prepared") and prior.job_id != ctx.job.id:
        raise ProviderError("xai", "submission_unknown",
                            "An earlier identical image request has an unknown outcome; reconcile before retrying.")
    if prior and prior.status == "submission_unknown":
        raise ProviderError("xai", "submission_unknown", "This image request's outcome is unknown; retry deliberately.")
    model = settings.XAI_IMAGE_MODEL
    ledger = await costs.reserve(workspace_id=ctx.job.workspace_id, project_id=project_id, job_id=ctx.job.id,
                                 run_id=ctx.job.run_id, provider="xai", model=model, operation="image",
                                 category="image", quantity=1, unit="image", job_cap=ctx.job.cost_cap_usd)
    attempt = await jobs.prepare_attempt(job=ctx.job, provider="xai", operation="image_edit" if reference else "image_generation",
                                         model=model, key=key, request_summary={"aspect_ratio": aspect, "prompt": prompt[:600]},
                                         reserved=ledger.estimated_usd)
    await ctx.beat(status="waiting_for_provider")
    try:
        if reference:
            res = await xai.edit_image(prompt, reference, aspect_ratio=aspect, model=model)
        else:
            res = await xai.generate_image(prompt, aspect_ratio=aspect, model=model)
    except ProviderError as e:
        if e.kind == "submission_unknown":
            await jobs.update_attempt(attempt.id, status="submission_unknown", error=e.as_dict())
        else:
            await jobs.update_attempt(attempt.id, status="failed", error=e.as_dict())
            await costs.release(ledger.id)
        raise
    a = await assetsvc.save(workspace_id=ctx.job.workspace_id, project_id=project_id, kind=kind, data=res["bytes"],
                            mime=res["mime"], source="xai", label=label, provider_model=model, brief_id=brief_id,
                            identity_hash=identity_hash, input_hash=input_hash, lineage=lineage,
                            metadata={"provider_aspect_ratio": aspect, "prompt": prompt[:1200],
                                      "native_size_note": "Provider output size; final presets are composed separately."})
    actual = res["cost_usd"]
    await jobs.update_attempt(attempt.id, status="succeeded", cost_actual_usd=actual, output_asset_ids=[str(a.id)],
                              response_summary={"asset_id": str(a.id), "bytes": len(res["bytes"])})
    await costs.settle(ledger.id, actual_usd=actual, attempt_id=attempt.id)
    return a


async def _store_review(asset_id: uuid.UUID, rv: dict) -> None:
    async with session_scope() as s:
        row = await s.get(Asset, asset_id)
        row.quality = {**(row.quality or {}), "background_review": rv}
        if rv.get("passed") is False:
            row.approval_state = "draft"


async def gated(make, ctx: "JobCtx", what: str) -> tuple[Asset, dict]:
    """Generate, review with vision, and regenerate ONCE if the image shows
    something it must not (e.g. a mobility device that is not the real product).
    Catching it here costs one image; catching it after video costs a clip."""
    a = await make("")
    if (a.quality or {}).get("background_review"):
        return a, a.quality["background_review"]
    rv = await review_image(a)
    await _store_review(a.id, rv)
    if rv.get("passed") is False:
        await ctx.emit(f"{what} failed fidelity review ({', '.join(rv['flags'])}); regenerating once", stage="review")
        a2 = await make("r1")
        rv2 = (a2.quality or {}).get("background_review") or await review_image(a2)
        await _store_review(a2.id, rv2)
        return a2, rv2
    return a, rv


# ---------------------------------------------------------------- images -----
async def produce_images(ctx: JobCtx, brief_id: uuid.UUID, presets: list[str], *, nonce: str = "",
                         reuse_background_from: dict | None = None, crop_focus: dict | None = None) -> dict:
    brief, photo, logo = await _brief_inputs(brief_id)
    blocked = _blocking_issues(brief)
    if blocked:
        raise ProviderError("launchlens", "invalid_input",
                            "The brief contains unsupported claims; edit the copy first: " +
                            "; ".join(f"{k}: {v[0]['term']}" for k, v in blocked.items()))
    product_img = await _open_image(photo)
    logo_img = await _open_image(logo) if logo else None
    c = brief.content
    copy = compose.Copy(headline=c["headline"], body=c["body"], cta=c["cta"], price_text=c.get("price_text", ""),
                        disclaimer=c.get("disclaimer", ""), language=brief.language)
    accent = "#FF7A45"
    async with session_scope() as s:
        from ..models import ProductVersion
        pv = await s.get(ProductVersion, brief.product_version_id)
        if pv and pv.brand_colours:
            accent = pv.brand_colours[0]
    out = {"created": [], "reused": [], "failed": []}
    for preset in presets[: settings.MAX_ASSETS_PER_BATCH]:
        await ctx.beat(status="running", stage=f"image:{preset}")
        aspect = compose.PRESETS[preset]["provider_aspect"]
        bg_input = stable_hash({"visual": brief.visual_hash, "prompt": c["background_prompt"], "aspect": aspect,
                                "model": settings.XAI_IMAGE_MODEL, "nonce": nonce})
        try:
            bg = None
            if reuse_background_from and reuse_background_from.get(preset):
                bg = await assetsvc.get(uuid.UUID(reuse_background_from[preset]))
            bg = bg or await assetsvc.find_by_input(ctx.job.workspace_id, "background", bg_input)
            if bg is None:
                await ctx.emit(f"Generating {preset} background with xAI", stage="image")

                def make_bg(suffix: str, _inp=bg_input, _aspect=aspect, _preset=preset):
                    return paid_image(ctx, key=f"img:{_inp}{suffix}", prompt=clean_prompt(c["background_prompt"]) + BG_GUARD,
                                      aspect=_aspect, kind="background", project_id=brief.project_id, brief_id=brief.id,
                                      label=f"xAI background ({settings.XAI_IMAGE_MODEL}, {_aspect})",
                                      lineage={"brief_id": str(brief.id), "visual_hash": brief.visual_hash},
                                      identity_hash=brief.identity_hash, input_hash=_inp if not suffix else
                                      stable_hash({"i": _inp, "s": suffix}))
                bg, _rv = await gated(make_bg, ctx, f"{preset} background")
            else:
                out["reused"].append({"preset": preset, "background_id": str(bg.id)})
            focus = (crop_focus or {}).get(preset) or {}
            flyer_input = stable_hash({"bg": str(bg.id), "copy": brief.copy_hash, "product": photo.sha256,
                                       "logo": logo.sha256 if logo else None, "preset": preset, "accent": accent, "v": 4,
                                       **({"focus": focus} if focus else {})})
            existing = await assetsvc.find_by_input(ctx.job.workspace_id, "flyer", flyer_input)
            if existing:
                out["reused"].append({"preset": preset, "flyer_id": str(existing.id)})
                continue
            bg_img = await _open_image(bg)
            final, layout, quality = await asyncio.to_thread(compose.compose, bg_img, product_img, copy, preset,
                                                             logo=logo_img, accent=accent,
                                                             ai_label=_ai_label(brief.language), crop_override=focus)
            quality["claims"] = claimcheck.check_many({"headline": copy.headline, "body": copy.body, "cta": copy.cta},
                                                      approved_claims=c.get("approved_claims_used", []),
                                                      enabled_features=[], disabled_features=[])
            layout["copy"] = {"headline": copy.headline, "body": copy.body, "cta": copy.cta, "price_text": copy.price_text,
                              "disclaimer": copy.disclaimer, "language": copy.language}
            flyer = await assetsvc.save(
                workspace_id=ctx.job.workspace_id, project_id=brief.project_id, kind="flyer", data=compose.to_png(final),
                mime="image/png", source="composed", label=f"Flyer · {preset} {compose.PRESETS[preset]['size'][0]}×{compose.PRESETS[preset]['size'][1]}",
                brief_id=brief.id, identity_hash=brief.identity_hash, preset=preset,
                group_key=f"flyer:{brief.lineage_id}:{preset}", input_hash=flyer_input,
                lineage={"background_asset_id": str(bg.id), "product_asset_id": str(photo.id),
                         "logo_asset_id": str(logo.id) if logo else None, "brief_id": str(brief.id),
                         "brief_version": brief.version, "strategy_version_id": str(brief.strategy_version_id)},
                layout=layout, quality=quality,
                approval_state="needs_review" if quality["passed"] and not quality["claims"] else "draft",
                metadata={"translation_status": brief.translation_status, "background_model": bg.provider_model})
            out["created"].append({"preset": preset, "flyer_id": str(flyer.id), "passed": quality["passed"]})
            await ctx.emit(f"Composed {preset} flyer", stage="image", asset_id=str(flyer.id))
        except ProviderError as e:
            out["failed"].append({"preset": preset, "error": e.as_dict()})
            await ctx.emit(f"{preset} flyer failed: {e.message}", stage="image")
            if e.kind in ("auth", "not_configured", "submission_unknown"):
                break
    return out


def _ai_label(language: str) -> str:
    return {"hi": "पृष्ठभूमि छवि: AI द्वारा निर्मित", "bn": "পটভূমির ছবি: AI দিয়ে তৈরি"}.get(language, "Background image: AI-generated")


# ---------------------------------------------------------------- video ------
async def _scene_frame(ctx: JobCtx, brief: CreativeBrief, scene: StoryboardScene, nonce: str) -> Asset:
    """Reference still for one scene, consistent with location and audience."""
    prompt = clean_prompt(f"{scene.shot_description}. Setting: {brief.content.get('setting', '')}. "
                          f"Mood: {brief.content.get('mood', '')}.") + SCENE_GUARD
    inp = stable_hash({"scene": scene.input_hash, "prompt": prompt, "nonce": nonce, "model": settings.XAI_IMAGE_MODEL})
    found = await assetsvc.find_by_input(ctx.job.workspace_id, "scene_frame", inp)
    if found:
        return found
    return await paid_image(ctx, key=f"frame:{inp}", prompt=prompt, aspect="9:16", kind="scene_frame",
                            project_id=brief.project_id, brief_id=brief.id, label=f"Scene {scene.idx + 1} reference frame (xAI)",
                            lineage={"scene_id": str(scene.id), "brief_id": str(brief.id)}, identity_hash=brief.identity_hash,
                            input_hash=inp)


def _jpeg_data_uri(data: bytes, max_side: int = 1024) -> str:
    im = Image.open(io.BytesIO(data)).convert("RGB")
    im.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=85)
    return xai.data_uri(buf.getvalue(), "image/jpeg")


async def _submit_scene(ctx: JobCtx, brief: CreativeBrief, scene: StoryboardScene, frame: Asset, nonce: str) -> dict:
    model = settings.XAI_VIDEO_MODEL
    seconds = int(scene.duration_s)
    prompt = clean_prompt(f"{scene.shot_description}. {brief.content.get('setting', '')}. {brief.content.get('mood', '')}.") + VIDEO_GUARD
    key = f"vid:{stable_hash({'scene': scene.input_hash, 'frame': frame.sha256, 'model': model, 'nonce': nonce, 's': seconds})}"
    prior = await jobs.find_attempt(key)
    if prior:
        if prior.status == "succeeded" and prior.output_asset_ids:
            return {"scene": scene, "attempt": prior, "state": "done_cached"}
        if prior.remote_request_id and prior.status in ("submitted", "waiting"):
            return {"scene": scene, "attempt": prior, "state": "pending"}
        if prior.status in ("submission_unknown", "prepared"):
            return {"scene": scene, "attempt": prior, "state": "submission_unknown"}
    ledger = await costs.reserve(workspace_id=ctx.job.workspace_id, project_id=brief.project_id, job_id=ctx.job.id,
                                 run_id=ctx.job.run_id, provider="xai", model=model, operation="video", category="video",
                                 quantity=seconds, unit="second", job_cap=ctx.job.cost_cap_usd)
    body = xai.video_body(prompt, seconds, "9:16", model=model, image_ref=_jpeg_data_uri(await assetsvc.load_bytes(frame)))
    summary = {k: v for k, v in body.items() if k != "image"} | {"image": f"reference frame asset {frame.id}"}
    attempt = await jobs.prepare_attempt(job=ctx.job, provider="xai", operation="video_generation", model=model, key=key,
                                         request_summary=summary, reserved=ledger.estimated_usd)
    await ctx.beat(status="waiting_for_provider")
    try:
        rid = await xai.start_video(body)
    except ProviderError as e:
        if e.kind == "submission_unknown":
            await jobs.update_attempt(attempt.id, status="submission_unknown", error=e.as_dict())
        else:
            await jobs.update_attempt(attempt.id, status="failed", error=e.as_dict())
            await costs.release(ledger.id)
        return {"scene": scene, "attempt": attempt, "state": "failed" if e.kind != "submission_unknown" else "submission_unknown",
                "error": e.as_dict()}
    await jobs.update_attempt(attempt.id, status="submitted", remote_request_id=rid,
                              response_summary={"ledger_id": str(ledger.id)})
    attempt.remote_request_id, attempt.status = rid, "submitted"
    attempt.response_summary = {"ledger_id": str(ledger.id)}
    await ctx.emit(f"Scene {scene.idx + 1} submitted to xAI (request {rid[:8]}…)", stage="video")
    return {"scene": scene, "attempt": attempt, "state": "pending"}


async def _poll_all(ctx: JobCtx, brief: CreativeBrief, pending: list[dict]) -> None:
    deadline = asyncio.get_running_loop().time() + settings.XAI_JOB_TIMEOUT_SECONDS
    interval = settings.XAI_POLL_INTERVAL_SECONDS
    while any(p["state"] == "pending" for p in pending):
        if asyncio.get_running_loop().time() > deadline:
            for p in pending:
                if p["state"] == "pending":
                    p["state"], p["error"] = "failed", {"kind": "failed", "message": "xAI did not finish before the deadline"}
                    await jobs.update_attempt(p["attempt"].id, status="failed", error=p["error"])
            break
        await ctx.beat(status="waiting_for_provider",
                       video={"pending": sum(p["state"] == "pending" for p in pending), "total": len(pending)})
        for p in pending:
            if p["state"] != "pending":
                continue
            st = await xai.poll_video(p["attempt"].remote_request_id)
            if st["state"] == "pending":
                continue
            ledger_id = (p["attempt"].response_summary or {}).get("ledger_id")
            if st["state"] == "done":
                data, mime = await fetch_media(st["url"], 300_000_000, expected=("video/",))
                with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
                    f.write(data)
                    f.flush()
                    info = await videosvc.probe(Path(f.name))
                clip = await assetsvc.save(
                    workspace_id=ctx.job.workspace_id, project_id=brief.project_id, kind="video_clip", data=data,
                    mime="video/mp4", source="xai", label=f"xAI clip · scene {p['scene'].idx + 1}",
                    provider_model=st.get("model") or settings.XAI_VIDEO_MODEL, remote_request_id=p["attempt"].remote_request_id,
                    brief_id=brief.id, identity_hash=brief.identity_hash, duration_s=info["duration"],
                    width=info["width"], height=info["height"], input_hash=p["attempt"].idempotency_key.split(":", 1)[-1][:64],
                    lineage={"scene_id": str(p["scene"].id), "brief_id": str(brief.id)}, metadata={"probe": info})
                await jobs.update_attempt(p["attempt"].id, status="succeeded", cost_actual_usd=st.get("cost_usd"),
                                          output_asset_ids=[str(clip.id)])
                if ledger_id:
                    await costs.settle(uuid.UUID(ledger_id), actual_usd=st.get("cost_usd"), attempt_id=p["attempt"].id)
                async with session_scope() as s:
                    sc = await s.get(StoryboardScene, p["scene"].id)
                    sc.clip_asset_id, sc.status = clip.id, "generated"
                p["state"], p["clip"] = "done", clip
                await ctx.emit(f"Scene {p['scene'].idx + 1} clip downloaded", stage="video", asset_id=str(clip.id))
            else:
                p["state"], p["error"] = "failed", {"kind": "failed", "message": st.get("error") or st["state"]}
                await jobs.update_attempt(p["attempt"].id, status="failed", error=p["error"])
                if ledger_id:
                    await costs.release(uuid.UUID(ledger_id))
                await ctx.emit(f"Scene {p['scene'].idx + 1} failed at xAI: {p['error']['message']}", stage="video")
        if any(p["state"] == "pending" for p in pending):
            await asyncio.sleep(interval)


async def produce_video(ctx: JobCtx, brief_id: uuid.UUID, *, orientations: list[str], mode: str = "full",
                        narration: bool = False, nonce: str = "", only_scene: int | None = None) -> dict:
    """mode='full': xAI clips + assembly. mode='animatic': draft from stills,
    clearly labelled as NOT xAI video. Failures stay visible."""
    brief, photo, logo = await _brief_inputs(brief_id)
    blocked = _blocking_issues(brief)
    if blocked:
        raise ProviderError("launchlens", "invalid_input", "Resolve unsupported claims in the brief before video generation.")
    async with session_scope() as s:
        sb = (await s.execute(select(Storyboard).where(Storyboard.brief_id == brief_id)
                              .order_by(Storyboard.version.desc()).limit(1))).scalar_one()
        scenes = list(sb.scenes)
    gen_scenes = [sc for sc in scenes if sc.kind == "generated"]
    end_scene = next((sc for sc in scenes if sc.kind == "end_card"), None)
    result: dict = {"mode": mode, "clips": [], "finals": [], "failed": [], "audio": None}
    def regenerate(sc) -> bool:
        """A scene is regenerated only when explicitly asked (regenerate / only_scene)
        or when it has no usable clip yet; otherwise its existing clip is reused."""
        if only_scene is not None:
            return sc.idx == only_scene
        return bool(nonce)

    reusable: dict[int, Asset] = {}
    if mode == "full":
        for sc in gen_scenes:
            if sc.clip_asset_id and not regenerate(sc):
                a = await assetsvc.get(sc.clip_asset_id)
                if a and not a.deleted_at and not a.stale:
                    reusable[sc.idx] = a
    frames: dict[int, Asset] = {}
    for sc in gen_scenes:
        await ctx.beat(status="running")
        if sc.idx in reusable:
            continue  # existing clip reused; no new reference frame needed
        if mode == "animatic" and not regenerate(sc):
            async with session_scope() as s:
                prior_frame = (await s.execute(select(Asset).where(
                    Asset.brief_id == brief.id, Asset.kind == "scene_frame", Asset.deleted_at.is_(None),
                    Asset.lineage["scene_id"].astext == str(sc.id)).order_by(Asset.created_at.desc()).limit(1))).scalar_one_or_none()
            if prior_frame:
                frames[sc.idx] = prior_frame
                continue
        try:
            base_nonce = nonce if regenerate(sc) else ""
            frame, rv = await gated(lambda suffix, _sc=sc, _n=base_nonce: _scene_frame(ctx, brief, _sc, _n + suffix),
                                    ctx, f"Scene {sc.idx + 1} reference frame")
            if rv.get("passed") is False:
                result["failed"].append({"scene": sc.idx, "stage": "fidelity_review",
                                         "error": {"kind": "failed", "message": "Reference frame failed fidelity review twice "
                                                   f"({', '.join(rv['flags'])}); no video was paid for this scene. "
                                                   "Edit the scene description and regenerate."}})
                continue
            frames[sc.idx] = frame
        except ProviderError as e:
            result["failed"].append({"scene": sc.idx, "stage": "reference_frame", "error": e.as_dict()})
            if e.kind in ("auth", "not_configured", "submission_unknown") or e.status == 402:
                return result
    clips: dict[int, Asset] = {}
    if mode == "full":
        pending = []
        for sc in gen_scenes:
            if sc.idx in reusable:
                clips[sc.idx] = reusable[sc.idx]
                result["clips"].append({"scene": sc.idx, "asset_id": str(reusable[sc.idx].id), "reused": True})
                continue
            if sc.idx not in frames:
                continue
            try:
                pending.append(await _submit_scene(ctx, brief, sc, frames[sc.idx], nonce if regenerate(sc) else ""))
            except ProviderError as e:
                result["failed"].append({"scene": sc.idx, "stage": "submit", "error": e.as_dict()})
                break
        for p in pending:
            if p["state"] == "done_cached":
                a = await assetsvc.get(uuid.UUID(p["attempt"].output_asset_ids[0]))
                if a:
                    clips[p["scene"].idx] = a
                    result["clips"].append({"scene": p["scene"].idx, "asset_id": str(a.id), "reused": True})
            elif p["state"] in ("failed", "submission_unknown"):
                result["failed"].append({"scene": p["scene"].idx, "stage": "submit",
                                         "error": p.get("error") or {"kind": "submission_unknown",
                                                                      "message": "Outcome of an earlier submission is unknown; reconcile before retrying."}})
        await _poll_all(ctx, brief, [p for p in pending if p["state"] == "pending"])
        for p in pending:
            if p.get("clip"):
                clips[p["scene"].idx] = p["clip"]
                result["clips"].append({"scene": p["scene"].idx, "asset_id": str(p["clip"].id),
                                        "remote_request_id": p["attempt"].remote_request_id})
            elif p["state"] == "failed" and not any(f["scene"] == p["scene"].idx for f in result["failed"]):
                result["failed"].append({"scene": p["scene"].idx, "stage": "generation", "error": p.get("error")})
        if len(clips) < len(gen_scenes):
            result["status"] = "video_incomplete"
            result["message"] = ("Native xAI video generation did not complete for every scene. Completed clips and "
                                 "images are kept. Retry the failed scenes, or build a separately labelled animatic.")
            return result
    # ---- assembly ----
    product_img = await _open_image(photo)
    logo_img = await _open_image(logo) if logo else None
    c = brief.content
    copy = compose.Copy(headline=c["headline"], body=c["body"], cta=c["cta"], price_text=c.get("price_text", ""),
                        language=brief.language)
    with tempfile.TemporaryDirectory(prefix="ll-prod-") as tmp:
        tmpd = Path(tmp)
        cut, info = compose.cutout(product_img)
        overlay_path = tmpd / "product.png"
        (cut if info["reliable"] else product_img.convert("RGBA")).save(overlay_path)
        logo_path = None
        if logo_img is not None:
            logo_path = tmpd / "logo.png"
            logo_img.convert("RGBA").save(logo_path)
        narr: dict[int, Path] = {}
        if narration:
            for sc in gen_scenes:
                if not sc.spoken_copy:
                    continue
                try:
                    from ..providers import sarvam
                    lead = ("sarvam" if sarvam.configured() else "fish") if brief.language != "en" else "fal"
                    lp, lm = voice.chars_cost_unit(lead)
                    ledger = await costs.reserve(workspace_id=ctx.job.workspace_id, project_id=brief.project_id,
                                                 job_id=ctx.job.id, run_id=ctx.job.run_id, provider=lp, model=lm,
                                                 operation="tts", category="audio", quantity=len(sc.spoken_copy) / 1000,
                                                 unit="1k_chars", job_cap=ctx.job.cost_cap_usd, allow_unknown_price=True)
                    audio, prov = await voice.speak(sc.spoken_copy, brief.language)
                    await costs.settle(ledger.id)
                    result.setdefault("narration_providers", []).append(prov)
                    p = tmpd / f"n{sc.idx}.mp3"
                    p.write_bytes(audio)
                    narr[sc.idx] = p
                except ProviderError as e:
                    result["audio"] = {"state": "narration_failed", "message": e.message}
                    narr = {}
                    break
        for orientation in orientations:
            await ctx.beat(status="running")
            W, H = videosvc.SIZES[orientation]
            segs = []
            for sc in gen_scenes:
                if mode == "full":
                    clip_path = tmpd / f"clip{sc.idx}.mp4"
                    clip_path.write_bytes(await assetsvc.load_bytes(clips[sc.idx]))
                    segs.append(videosvc.Segment(clip_path, None, float(sc.duration_s), sc.on_screen_text,
                                                 narration=narr.get(sc.idx), label=f"scene {sc.idx + 1}",
                                                 overlay=overlay_path if sc.product_reference_asset_id else None))
                else:
                    still = tmpd / f"still{sc.idx}.jpg"
                    im = await _open_image(frames[sc.idx])
                    im.convert("RGB").save(still, quality=92)
                    segs.append(videosvc.Segment(None, still, float(sc.duration_s), sc.on_screen_text,
                                                 narration=narr.get(sc.idx), label=f"scene {sc.idx + 1} (still)"))
            end_png = tmpd / f"end_{orientation}.png"
            await asyncio.to_thread(lambda: compose.end_card(product_img, copy, (W, H), logo=logo_img).save(end_png))
            segs.append(videosvc.Segment(None, end_png, float(end_scene.duration_s if end_scene else 3), "", label="end card"))
            out = tmpd / f"final_{orientation}.mp4"
            res = await videosvc.assemble(segs, orientation, out, language=brief.language, logo=logo_path,
                                          transform="cover" if orientation == "vertical" else "blur_fill")
            val = await videosvc.validate(out, orientation=orientation, expected_s=res.duration, audio_state=res.audio_state)
            claim_issues = claimcheck.check_many({f"caption{i}": s.caption for i, s in enumerate(segs) if s.caption},
                                                 approved_claims=c.get("approved_claims_used", []), enabled_features=[],
                                                 disabled_features=[])
            is_native = mode == "full"
            label = (f"Final video · {orientation} · xAI {settings.XAI_VIDEO_MODEL} clips + deterministic assembly"
                     if is_native else f"Draft animatic · {orientation} · stills only — NOT xAI-generated video")
            quality = {"video": val["checks"], "claims": claim_issues, "audio_state": res.audio_state,
                       "transform": "native 9:16 clips" if orientation == "vertical" else "9:16 clips transformed to 16:9 with blurred fill",
                       "product_identity": "real product photo composited as overlay and end card; generated clips exclude the product",
                       "passed": val["checks"]["passed"] and not claim_issues}
            final = await assetsvc.save(
                workspace_id=ctx.job.workspace_id, project_id=brief.project_id, kind="video_final" if is_native else "video_animatic",
                data=out.read_bytes(), mime="video/mp4", source="ffmpeg" if is_native else "fallback_slideshow", label=label,
                brief_id=brief.id, identity_hash=brief.identity_hash, preset=orientation,
                group_key=f"{'video' if is_native else 'animatic'}:{brief.lineage_id}:{orientation}",
                input_hash=stable_hash({"clips": sorted(str(a.id) for a in clips.values()), "copy": brief.copy_hash,
                                        "o": orientation, "narr": bool(narr), "mode": mode}),
                duration_s=res.duration, width=W, height=H,
                lineage={"clip_asset_ids": {str(k): str(v.id) for k, v in clips.items()},
                         "frame_asset_ids": {str(k): str(v.id) for k, v in frames.items()},
                         "product_asset_id": str(photo.id), "brief_id": str(brief.id), "brief_version": brief.version,
                         "storyboard_id": str(sb.id)},
                layout={"timeline": res.timeline}, quality=quality,
                approval_state="needs_review" if quality["passed"] else "draft",
                metadata={"audio_state": res.audio_state, "subtitles": {"srt": res.srt, "vtt": res.vtt}, "probe": res.probe,
                          "translation_status": brief.translation_status})
            thumb = await assetsvc.save(workspace_id=ctx.job.workspace_id, project_id=brief.project_id, kind="thumbnail",
                                        data=res.thumbnail.read_bytes(), mime="image/jpeg", source="ffmpeg",
                                        label=f"Thumbnail · {orientation}", brief_id=brief.id,
                                        lineage={"video_asset_id": str(final.id)})
            for ext, text, mime in (("srt", res.srt, "application/x-subrip"), ("vtt", res.vtt, "text/vtt")):
                await assetsvc.save(workspace_id=ctx.job.workspace_id, project_id=brief.project_id, kind="subtitles",
                                    data=text.encode(), mime=mime, source="ffmpeg", label=f"Subtitles ({ext}) · {orientation}",
                                    brief_id=brief.id, lineage={"video_asset_id": str(final.id)}, metadata={"format": ext})
            result["finals"].append({"orientation": orientation, "asset_id": str(final.id), "thumbnail_id": str(thumb.id),
                                     "duration": res.duration, "passed": quality["passed"], "audio_state": res.audio_state,
                                     "native_xai": is_native})
            await ctx.emit(f"{'Final video' if is_native else 'Animatic'} ({orientation}) assembled", stage="video",
                           asset_id=str(final.id))
    result["status"] = "completed" if not result["failed"] else "partially_completed"
    return result


# ---------------------------------------------------------------- review -----
class _BgReview(BaseModel):
    contains_wheelchair_or_mobility_device: bool
    contains_fan_microphone_or_gadget: bool
    contains_readable_text_or_logo: bool
    people_portrayed_with_dignity: bool
    notes: str


async def review_image(asset: Asset) -> dict:
    """Vision check that a generated background/frame does not depict the
    product or features (fidelity) and has no stray text."""
    try:
        r, model = await llm.structured(
            _BgReview, "You check advertising background images for compliance. Answer strictly from what is visible.",
            "Inspect this generated background image.", images=[_jpeg_data_uri(await assetsvc.load_bytes(asset), 768)],
            max_tokens=300, temperature=0)
        flags = [k for k, v in r.model_dump().items() if k.startswith("contains") and v]
        if not r.people_portrayed_with_dignity:
            flags.append("dignity_concern")
        return {"model": model, "flags": flags, "notes": r.notes, "passed": not flags}
    except ProviderError as e:
        return {"model": None, "flags": [], "notes": f"Vision review unavailable: {e.message}", "passed": None}


class _CopyIssue(BaseModel):
    field: str
    issue: str
    suggestion: str = ""


class _CopyReview(BaseModel):
    spelling_and_grammar_ok: bool
    issues: list[_CopyIssue] = []
    back_translation: str = ""
    meaning_preserved: bool | None = None


async def copy_review(brief_id: uuid.UUID) -> dict:
    """Spelling/grammar check (English) or back-translation meaning check
    (Hindi/Bengali). Advisory: findings are shown to the owner for review."""
    async with session_scope() as s:
        b = await s.get(CreativeBrief, brief_id)
        c = dict(b.content)
        lang = b.language
    fields = {k: c.get(k, "") for k in ("headline", "body", "cta", "disclaimer") if c.get(k)}
    src = c.get("source_copy") or {}
    instr = ("Check this advertising copy for spelling and grammar errors only; do not restyle it." if lang == "en" else
             f"This copy is in {'Hindi' if lang == 'hi' else 'Bengali'}. Check spelling/grammar in that language, give a "
             "literal English back-translation, and say whether it preserves the meaning of the English source.")
    try:
        r, model = await llm.structured(_CopyReview, instr,
                                        f"<data>\nCOPY: {fields}\nENGLISH SOURCE: {src or 'n/a'}\n</data>",
                                        max_tokens=800, temperature=0)
        out = {**r.model_dump(), "model": model, "language": lang}
    except ProviderError as e:
        out = {"error": e.message, "language": lang}
    async with session_scope() as s:
        b = await s.get(CreativeBrief, brief_id)
        b.content = {**b.content, "copy_review": out}
    return out


async def quality_review(ctx: JobCtx, brief_id: uuid.UUID) -> dict:
    """Review generated images for this brief and attach findings. Assets are
    never auto-approved: they move to needs_review or stay draft."""
    async with session_scope() as s:
        items = (await s.execute(select(Asset).where(Asset.brief_id == brief_id, Asset.deleted_at.is_(None),
                                                     Asset.kind.in_(("background", "scene_frame"))))).scalars().all()
    reviewed = []
    for a in items:
        rv = (a.quality or {}).get("background_review")
        if not rv:
            await ctx.beat()
            rv = await review_image(a)
        async with session_scope() as s:
            row = await s.get(Asset, a.id)
            row.quality = {**(row.quality or {}), "background_review": rv}
            if rv.get("passed") is False:
                row.approval_state = "draft"
            # propagate to flyers built on this background and videos built from this frame
            outs = (await s.execute(select(Asset).where(Asset.brief_id == brief_id,
                                                        Asset.kind.in_(("flyer", "video_final", "video_animatic"))))).scalars().all()
            for f in outs:
                lin = f.lineage or {}
                if lin.get("background_asset_id") == str(a.id) or str(a.id) in (lin.get("frame_asset_ids") or {}).values():
                    reviews = {**((f.quality or {}).get("source_reviews") or {}), str(a.id): rv}
                    f.quality = {**(f.quality or {}), "source_reviews": reviews,
                                 **({"background_review": rv} if f.kind == "flyer" else {})}
                    if rv.get("passed") is False:
                        f.approval_state = "draft"
        reviewed.append({"asset_id": str(a.id), **rv})
    async with session_scope() as s:
        b = await s.get(CreativeBrief, brief_id)
        needs_copy = b is not None and not (b.content or {}).get("copy_review")
    copy = await copy_review(brief_id) if needs_copy else None
    return {"reviewed": reviewed, "copy_review": copy}

