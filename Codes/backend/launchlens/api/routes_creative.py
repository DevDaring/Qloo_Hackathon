"""Creative briefs, image/video generation, storyboard scenes, jobs and
attempt reconciliation, assets, exports, campaign results, provider status,
usage and health."""
from __future__ import annotations

import asyncio
import csv
import io
import time
import uuid
from datetime import UTC, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import SessionLocal, get_session
from ..errors import AppError
from ..models import (
    Asset, CampaignResult, CreativeBrief, Export, Job, ProviderAttempt, Storyboard, StoryboardScene, StrategyVersion,
    UsageLedger,
)
from ..providers import geo, llm, media, qloo, voice
from ..security import Principal, current_principal, require_editor
from ..services import costs, hashing, jobs, revisions
from ..storage import storage
from . import schemas as S
from .deps import asset_out, brief_out, check_project, costly_limiter, job_out, num, owned

router = APIRouter(prefix="/api/v1")


# ---------------------------------------------------------------- briefs -----
@router.get("/projects/{project_id}/creative-briefs", tags=["creative"])
async def list_briefs(project_id: uuid.UUID, current_only: bool = True, p: Principal = Depends(current_principal),
                      s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    q = select(CreativeBrief).where(CreativeBrief.project_id == project_id).order_by(CreativeBrief.created_at.desc())
    if current_only:
        q = q.where(CreativeBrief.is_current.is_(True))
    briefs = (await s.execute(q)).scalars().all()
    out = []
    for b in briefs:
        assets = (await s.execute(select(Asset).where(Asset.brief_id == b.id, Asset.deleted_at.is_(None),
                                                      Asset.kind.in_(("flyer", "video_final", "video_animatic", "thumbnail")))
                                  .order_by(Asset.created_at.desc()))).scalars().all()
        out.append({**brief_out(b), "assets": [asset_out(a) for a in assets]})
    return {"items": out}


@router.get("/creative-briefs/{brief_id}", tags=["creative"])
async def get_brief(brief_id: uuid.UUID, p: Principal = Depends(current_principal), s: AsyncSession = Depends(get_session)):
    b = await owned(s, p, CreativeBrief, brief_id)
    sb = (await s.execute(select(Storyboard).where(Storyboard.brief_id == b.id).order_by(Storyboard.version.desc()).limit(1))).scalar_one_or_none()
    assets = (await s.execute(select(Asset).where(Asset.brief_id == b.id, Asset.deleted_at.is_(None)).order_by(Asset.created_at.desc()))).scalars().all()
    versions = (await s.execute(select(CreativeBrief.id, CreativeBrief.version, CreativeBrief.created_at).where(
        CreativeBrief.lineage_id == b.lineage_id).order_by(CreativeBrief.version.desc()))).all()
    sv = await s.get(StrategyVersion, b.strategy_version_id)
    active = (await s.execute(select(Job).where(Job.project_id == b.project_id, Job.kind.in_(("images", "video")),
                                                Job.payload["brief_id"].astext == str(b.id)).order_by(Job.created_at.desc()).limit(5))).scalars().all()
    return {**brief_out(b),
            "strategy": {"id": str(sv.id), "version": sv.version, "area": sv.content.get("selected", {}).get("area_name"),
                         "audience": sv.content.get("selected", {}).get("audience_name"), "stale": sv.stale},
            "storyboard": {"id": str(sb.id), "total_seconds": num(sb.total_seconds), "aspect_ratio": sb.aspect_ratio,
                           "audio_plan": sb.audio_plan,
                           "scenes": [{"id": str(sc.id), "idx": sc.idx, "kind": sc.kind, "purpose": sc.purpose,
                                       "shot_description": sc.shot_description, "duration_s": num(sc.duration_s),
                                       "spoken_copy": sc.spoken_copy, "on_screen_text": sc.on_screen_text,
                                       "product_overlay": sc.product_reference_asset_id is not None,
                                       "clip_asset_id": str(sc.clip_asset_id) if sc.clip_asset_id else None,
                                       "status": sc.status} for sc in sb.scenes]} if sb else None,
            "assets": [asset_out(a) for a in assets],
            "versions": [{"id": str(i), "version": v, "created_at": c.isoformat()} for i, v, c in versions],
            "jobs": [job_out(j) for j in active]}


@router.post("/projects/{project_id}/creative-briefs", tags=["creative"], status_code=202)
async def create_brief(project_id: uuid.UUID, body: S.BriefIn, p: Principal = Depends(require_editor),
                       s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    sv = await owned(s, p, StrategyVersion, body.strategy_version_id)
    if sv.stale:
        raise AppError(409, "stale_strategy", "This strategy is stale; regenerate it before writing new creative.")
    job, created = await jobs.enqueue(
        workspace_id=p.workspace_id, project_id=project_id, kind="brief", created_by=p.user_id,
        payload={"strategy_version_id": str(sv.id), "language": body.language, "channel": body.channel,
                 "objective": body.objective, "angle": body.angle},
        idempotency_key=f"brief:{sv.id}:{body.language}:{body.channel}:{body.angle}:{uuid.uuid4().hex[:6]}")
    return {"job": job_out(job)}


@router.patch("/creative-briefs/{brief_id}", tags=["creative"])
async def edit_brief(brief_id: uuid.UUID, body: S.BriefPatch, p: Principal = Depends(require_editor),
                     s: AsyncSession = Depends(get_session)):
    """Manual edit creates a new brief version (optimistic lock). A copy edit
    invalidates only composed media; research and strategy are untouched."""
    from ..services import claims as claimcheck
    from ..services import context as ctxsvc
    old = await owned(s, p, CreativeBrief, brief_id)
    if body.lock_version != old.lock_version:
        raise AppError(409, "version_conflict", "Someone else changed this brief. Reload to see the latest version.",
                       details={"current_lock_version": old.lock_version})
    if not old.is_current:
        raise AppError(409, "not_current", "Edit the current version of this brief.")
    edits = body.model_dump(exclude_none=True, exclude={"lock_version"})
    content = {**old.content, **edits}
    ctx = await ctxsvc.load(old.project_id)
    feats = [f for f in ctx["product"]["features"] if f["enabled"]]
    issues = claimcheck.check_many({k: content.get(k, "") for k in ("headline", "body", "cta", "disclaimer")},
                                   approved_claims=[c["text"] for c in ctx["claims"] if c["approved"]],
                                   enabled_features=[f["key"] for f in feats],
                                   disabled_features=[f["key"] for f in ctx["product"]["features"] if not f["enabled"]])
    content["claim_issues"] = issues
    old.is_current = False
    old.lock_version += 1
    new = CreativeBrief(project_id=old.project_id, strategy_version_id=old.strategy_version_id, lineage_id=old.lineage_id,
                        version=old.version + 1, product_version_id=old.product_version_id, area_id=old.area_id,
                        audience_version_id=old.audience_version_id, language=old.language, channel=old.channel,
                        objective=old.objective, angle=old.angle, identity_hash=old.identity_hash, content=content,
                        decisions=old.decisions + [{"decision": f"Manual edit: {', '.join(edits)}", "rationale": "Edited by owner",
                                                    "evidence_ids": [], "kind": "owner_edit"}],
                        approval_state="draft",
                        translation_status="owner_edited" if old.language != "en" and any(k in edits for k in ("headline", "body", "cta")) else old.translation_status,
                        copy_hash=hashing.copy_hash(content), visual_hash=hashing.visual_hash(content))
    s.add(new)
    await s.flush()
    sb = (await s.execute(select(Storyboard).where(Storyboard.brief_id == old.id).order_by(Storyboard.version.desc()).limit(1))).scalar_one_or_none()
    if sb:
        nsb = Storyboard(brief_id=new.id, version=1, total_seconds=sb.total_seconds, aspect_ratio=sb.aspect_ratio, audio_plan=sb.audio_plan)
        s.add(nsb)
        await s.flush()
        for sc in sb.scenes:
            s.add(StoryboardScene(storyboard_id=nsb.id, idx=sc.idx, kind=sc.kind, purpose=sc.purpose,
                                  shot_description=sc.shot_description, duration_s=sc.duration_s,
                                  product_reference_asset_id=sc.product_reference_asset_id, spoken_copy=sc.spoken_copy,
                                  on_screen_text=content["cta"] if sc.kind == "end_card" else sc.on_screen_text,
                                  claim_ids=sc.claim_ids, clip_asset_id=sc.clip_asset_id, status=sc.status,
                                  input_hash=sc.input_hash))
    await s.commit()
    rev = await revisions.brief_edited(old.project_id, p.user_id, old, new)
    return {"brief": brief_out(new), "revision": rev, "claim_issues": issues}


@router.post("/creative-briefs/{brief_id}/approve", tags=["creative"])
async def approve_brief(brief_id: uuid.UUID, body: S.ApprovalIn, p: Principal = Depends(require_editor),
                        s: AsyncSession = Depends(get_session)):
    b = await owned(s, p, CreativeBrief, brief_id)
    if body.state == "approved" and any(any(i.get("severity") == "block" for i in v) for v in (b.content.get("claim_issues") or {}).values()):
        raise AppError(422, "claim_issues", "Resolve unsupported claims before approving.")
    if body.state == "approved" and b.translation_status == "machine_translated_needs_review":
        b.translation_status = "reviewed_by_owner"
    b.approval_state = body.state
    await s.commit()
    return brief_out(b)


@router.post("/creative-briefs/{brief_id}/duplicate", tags=["creative"], status_code=202)
async def duplicate_brief(brief_id: uuid.UUID, body: S.DuplicateIn, p: Principal = Depends(require_editor),
                          s: AsyncSession = Depends(get_session)):
    """Duplicate for another audience: a NEW campaign identity built from that
    audience's strategy, so an incompatible ad is never reused."""
    b = await owned(s, p, CreativeBrief, brief_id)
    sv = await owned(s, p, StrategyVersion, body.strategy_version_id)
    if sv.project_id != b.project_id:
        raise AppError(422, "other_project", "Strategy belongs to another project.")
    job, _ = await jobs.enqueue(workspace_id=p.workspace_id, project_id=b.project_id, kind="brief", created_by=p.user_id,
                                payload={"strategy_version_id": str(sv.id), "language": body.language or b.language,
                                         "channel": b.channel, "objective": b.objective, "angle": body.angle},
                                idempotency_key=f"dup:{b.id}:{sv.id}:{body.language}:{body.angle}:{uuid.uuid4().hex[:6]}")
    return {"job": job_out(job)}


@router.patch("/scenes/{scene_id}", tags=["creative"])
async def edit_scene(scene_id: uuid.UUID, body: S.ScenePatch, p: Principal = Depends(require_editor),
                     s: AsyncSession = Depends(get_session)):
    sc = await s.get(StoryboardScene, scene_id)
    if sc is None:
        raise AppError(404, "not_found", "Scene not found.")
    sb = await s.get(Storyboard, sc.storyboard_id)
    await owned(s, p, CreativeBrief, sb.brief_id)
    data = body.model_dump(exclude_none=True)
    if "product_overlay" in data:
        want = data.pop("product_overlay")
        if sc.kind == "end_card":
            raise AppError(422, "end_card", "The end card always shows the real product.")
        if want:
            from ..models import ProductAsset
            brief = await s.get(CreativeBrief, sb.brief_id)
            pa = (await s.execute(select(ProductAsset).where(ProductAsset.project_id == brief.project_id,
                                                             ProductAsset.role == "product_photo")
                                  .order_by(ProductAsset.is_primary.desc()).limit(1))).scalar_one_or_none()
            if pa is None:
                raise AppError(409, "no_product_photo", "Upload a product photo first.")
            sc.product_reference_asset_id = pa.asset_id
        else:
            sc.product_reference_asset_id = None
    visual = any(k in data for k in ("shot_description", "duration_s"))
    for k, v in data.items():
        setattr(sc, k, Decimal(v) if k == "duration_s" else v)
    if visual:
        from ..services.cache import stable_hash
        sc.input_hash = stable_hash({"shot_description": sc.shot_description, "duration_s": int(sc.duration_s)})
        sc.clip_asset_id, sc.status = None, "planned"
    sb.total_seconds = sum((x.duration_s for x in sb.scenes), Decimal(0))
    await s.commit()
    return {"ok": True, "regeneration_needed": visual,
            "note": "Caption/narration edits re-assemble the video without new generation." if not visual else
                    "This scene's clip must be regenerated; other scenes are reused."}


# ---------------------------------------------------------------- generation -
async def _gen_guard(p: Principal, s: AsyncSession, b: CreativeBrief):
    costly_limiter.check(str(p.user_id))
    if p.is_demo and not settings.DEMO_GENERATION_ENABLED:
        raise AppError(403, "demo_generation_disabled", "Generation is disabled in the public demo.")
    if not media.configured():
        raise AppError(503, "media_unavailable", "Image and video generation is not configured (no NanoGPT or xAI key).")
    if b.stale:
        raise AppError(409, "stale_brief", f"This brief is stale ({b.stale_reason}). Create a fresh brief first.")
    if any(any(i.get("severity") == "block" for i in v) for v in (b.content.get("claim_issues") or {}).values()):
        raise AppError(422, "claim_issues", "Edit the copy to remove unsupported claims before generating.")


@router.get("/creative-briefs/{brief_id}/estimate", tags=["creative"])
async def estimate_generation(brief_id: uuid.UUID, presets: str = "square", mode: str = "full", only_scene: int | None = None,
                              narration: bool = False, p: Principal = Depends(current_principal),
                              s: AsyncSession = Depends(get_session)):
    """Cost estimate BEFORE queuing (upper bound: assumes nothing is reused)."""
    b = await owned(s, p, CreativeBrief, brief_id)
    n_img = len([x for x in presets.split(",") if x])
    img, img_src = costs.estimate(media.primary(), media.image_model(), "image", n_img)
    sb = (await s.execute(select(Storyboard).where(Storyboard.brief_id == b.id).order_by(Storyboard.version.desc()).limit(1))).scalar_one_or_none()
    gen = [sc for sc in (sb.scenes if sb else []) if sc.kind == "generated" and (only_scene is None or sc.idx == only_scene)]
    secs = sum(int(sc.duration_s) for sc in gen)
    frames, _ = costs.estimate(media.primary(), media.image_model(), "image", len(gen))
    vid_list, vid_src = costs.estimate(media.primary("video"), media.video_model(), "second", secs) if mode == "full" else (Decimal(0), "")
    vid_held = costs.reservation(media.primary("video"), media.video_model(), "second", secs) if mode == "full" else Decimal(0)
    chars = sum(len(sc.spoken_copy or "") for sc in gen) if narration else 0
    def s_(v):
        return str(v) if v is not None else "unknown"
    return {"images": {"count": n_img, "usd": s_(img), "model": settings.XAI_IMAGE_MODEL, "source": img_src},
            "video": {"mode": mode, "scenes": len(gen), "generated_seconds": secs, "frames_usd": s_(frames),
                      "clips_list_usd": s_(vid_list), "clips_held_usd": s_(vid_held), "model": settings.XAI_VIDEO_MODEL,
                      "source": vid_src or "pricing file", "narration_chars": chars},
            "notes": ["Upper bound: reused backgrounds, frames and clips cost nothing.",
                      "Video is reserved at list price x headroom because observed charges exceeded list price.",
                      "Actual cost is recorded from provider usage after each call."]}


@router.post("/creative-briefs/{brief_id}/images", tags=["creative"], status_code=202)
async def queue_images(brief_id: uuid.UUID, body: S.ImagesIn, p: Principal = Depends(require_editor),
                       s: AsyncSession = Depends(get_session)):
    b = await owned(s, p, CreativeBrief, brief_id)
    await _gen_guard(p, s, b)
    est, src = costs.estimate(media.primary(), media.image_model(), "image", len(body.presets))
    nonce = uuid.uuid4().hex[:8] if body.regenerate_background else ""
    focus = {k: v.model_dump() for k, v in body.crop_focus.items()}
    from ..services.cache import stable_hash
    key = body.idempotency_key or f"images:{b.id}:{','.join(sorted(body.presets))}:{b.copy_hash[:10]}:{stable_hash(focus)[:8]}:{nonce}"
    job, created = await jobs.enqueue(workspace_id=p.workspace_id, project_id=b.project_id, kind="images", created_by=p.user_id,
                                      payload={"brief_id": str(b.id), "presets": body.presets, "nonce": nonce,
                                               "crop_focus": focus},
                                      idempotency_key=key, cost_cap_usd=body.cap_usd, max_attempts=settings.MAX_GENERATION_ATTEMPTS,
                                      deadline_s=3600)
    return {"job": job_out(job), "created": created,
            "estimate": {"usd": str(est) if est is not None else "unknown", "source": src,
                         "note": "Upper bound if every background is new; reused backgrounds cost nothing."}}


@router.post("/creative-briefs/{brief_id}/videos", tags=["creative"], status_code=202)
async def queue_video(brief_id: uuid.UUID, body: S.VideosIn, p: Principal = Depends(require_editor),
                      s: AsyncSession = Depends(get_session)):
    b = await owned(s, p, CreativeBrief, brief_id)
    await _gen_guard(p, s, b)
    sb = (await s.execute(select(Storyboard).where(Storyboard.brief_id == b.id).order_by(Storyboard.version.desc()).limit(1))).scalar_one()
    gen_seconds = sum(int(sc.duration_s) for sc in sb.scenes if sc.kind == "generated" and (body.only_scene is None or sc.idx == body.only_scene))
    if float(sb.total_seconds) > settings.MAX_VIDEO_SECONDS + 1:
        raise AppError(422, "too_long", f"Storyboard is {sb.total_seconds}s; the limit is {settings.MAX_VIDEO_SECONDS}s.")
    n_frames = sum(1 for sc in sb.scenes if sc.kind == "generated")
    img_est, _ = costs.estimate(media.primary(), media.image_model(), "image", n_frames)
    vid_est = costs.reservation(media.primary("video"), media.video_model(), "second", gen_seconds) if body.mode == "full" else Decimal(0)
    src = "pricing file (list price x reserve_multiplier headroom)"
    nonce = uuid.uuid4().hex[:8] if body.regenerate else ""
    from ..services.cache import stable_hash
    board = stable_hash([(sc.idx, sc.shot_description, str(sc.duration_s), sc.on_screen_text, sc.spoken_copy,
                          str(sc.product_reference_asset_id)) for sc in sb.scenes])[:12]
    key = body.idempotency_key or f"video:{b.id}:{body.mode}:{','.join(sorted(body.orientations))}:{body.narration}:{body.only_scene}:{b.copy_hash[:10]}:{board}:{nonce}"
    job, created = await jobs.enqueue(workspace_id=p.workspace_id, project_id=b.project_id, kind="video", created_by=p.user_id,
                                      payload={"brief_id": str(b.id), "orientations": body.orientations, "mode": body.mode,
                                               "narration": body.narration, "only_scene": body.only_scene, "nonce": nonce},
                                      idempotency_key=key, cost_cap_usd=body.cap_usd, max_attempts=settings.MAX_GENERATION_ATTEMPTS,
                                      deadline_s=int(settings.XAI_JOB_TIMEOUT_SECONDS) + 1800)
    total = (img_est or 0) + (vid_est or 0) if img_est is not None and vid_est is not None else None
    return {"job": job_out(job), "created": created,
            "estimate": {"usd": str(total) if total is not None else "unknown", "generated_seconds": gen_seconds,
                         "source": src, "note": "Held against your cap: reference frames + clips with headroom. Actual cost is "
                                                "recorded from xAI usage; reused items cost nothing."}}


# ---------------------------------------------------------------- jobs -------
@router.get("/jobs/{job_id}", tags=["jobs"])
async def get_job(job_id: uuid.UUID, p: Principal = Depends(current_principal), s: AsyncSession = Depends(get_session)):
    j = await owned(s, p, Job, job_id)
    atts = (await s.execute(select(ProviderAttempt).where(ProviderAttempt.job_id == j.id).order_by(ProviderAttempt.created_at))).scalars().all()
    return {**job_out(j), "attempts": [{"id": str(a.id), "provider": a.provider, "operation": a.operation, "model": a.model,
                                        "status": a.status, "remote_request_id": a.remote_request_id, "error": a.error,
                                        "cost_reserved_usd": num(a.cost_reserved_usd), "cost_actual_usd": num(a.cost_actual_usd),
                                        "output_asset_ids": a.output_asset_ids, "created_at": a.created_at.isoformat()} for a in atts]}


@router.get("/projects/{project_id}/jobs", tags=["jobs"])
async def project_jobs(project_id: uuid.UUID, active: bool = False, p: Principal = Depends(current_principal),
                       s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    q = select(Job).where(Job.project_id == project_id).order_by(Job.created_at.desc()).limit(50)
    if active:
        q = q.where(Job.status.notin_(jobs.TERMINAL))
    return {"items": [job_out(j) for j in (await s.execute(q)).scalars().all()]}


@router.post("/jobs/{job_id}/retry", tags=["jobs"], status_code=202)
async def retry_job(job_id: uuid.UUID, body: S.RetryIn, p: Principal = Depends(require_editor),
                    s: AsyncSession = Depends(get_session)):
    j = await owned(s, p, Job, job_id)
    if j.status not in ("failed", "partially_completed", "cancelled"):
        raise AppError(409, "not_retryable", f"A {j.status} job cannot be retried.")
    unknown = (await s.execute(select(ProviderAttempt).where(ProviderAttempt.job_id == j.id,
                                                             ProviderAttempt.status == "submission_unknown"))).scalars().all()
    if unknown and not body.confirm_unknown_submissions:
        raise AppError(409, "reconcile_first", f"{len(unknown)} paid request(s) have an unknown outcome. Reconcile them, or "
                       "confirm that retrying may pay again.", details={"attempt_ids": [str(a.id) for a in unknown]})
    payload = dict(j.payload)
    if unknown:
        payload["nonce"] = uuid.uuid4().hex[:8]  # a deliberate fresh request
        for a in unknown:
            a.status = "reconciled"
            a.error = {**(a.error or {}), "resolution": "owner chose to retry; reservation kept until reconciled"}
    await s.commit()
    new, _ = await jobs.enqueue(workspace_id=j.workspace_id, project_id=j.project_id, run_id=j.run_id, kind=j.kind,
                                payload=payload, idempotency_key=f"retry:{j.id}:{uuid.uuid4().hex[:8]}", created_by=p.user_id,
                                cost_cap_usd=j.cost_cap_usd, max_attempts=j.max_attempts, parent_job_id=j.id,
                                deadline_s=int(settings.XAI_JOB_TIMEOUT_SECONDS) + 1800)
    return {"job": job_out(new), "reused": "Completed images, clips and attempts from the failed job are reused automatically."}


@router.post("/jobs/{job_id}/cancel", tags=["jobs"])
async def cancel_job(job_id: uuid.UUID, p: Principal = Depends(require_editor), s: AsyncSession = Depends(get_session)):
    j = await owned(s, p, Job, job_id)
    st = await jobs.request_cancel(j.id)
    return {"status": st, "note": "No new paid calls will start; submitted requests may still be billed (xAI has no cancel endpoint)."}


@router.post("/attempts/{attempt_id}/reconcile", tags=["jobs"])
async def reconcile(attempt_id: uuid.UUID, body: S.ReconcileIn, p: Principal = Depends(require_editor),
                    s: AsyncSession = Depends(get_session)):
    a = await owned(s, p, ProviderAttempt, attempt_id)
    if a.status != "submission_unknown":
        raise AppError(409, "not_unknown", "Only unknown submissions need reconciliation.")
    a.status = "reconciled"
    a.error = {**(a.error or {}), "resolution": body.outcome, "note": body.note}
    led = (await s.execute(select(UsageLedger).where(UsageLedger.job_id == a.job_id, UsageLedger.state == "reserved",
                                                     UsageLedger.estimated_usd == a.cost_reserved_usd).limit(1))).scalar_one_or_none()
    if led:
        led.state = "released" if body.outcome == "not_charged" else "committed"
    await s.commit()
    return {"status": a.status, "ledger": led.state if led else None}


# ---------------------------------------------------------------- assets -----
@router.get("/projects/{project_id}/assets", tags=["assets"])
async def list_assets(project_id: uuid.UUID, kind: str | None = None, include_stale: bool = True,
                      p: Principal = Depends(current_principal), s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    q = select(Asset).where(Asset.project_id == project_id, Asset.deleted_at.is_(None)).order_by(Asset.created_at.desc()).limit(500)
    if kind:
        q = q.where(Asset.kind.in_(kind.split(",")))
    if not include_stale:
        q = q.where(Asset.stale.is_(False))
    return {"items": [asset_out(a) for a in (await s.execute(q)).scalars().all()]}


@router.get("/assets/{asset_id}", tags=["assets"])
async def get_asset(asset_id: uuid.UUID, p: Principal = Depends(current_principal), s: AsyncSession = Depends(get_session)):
    a = await owned(s, p, Asset, asset_id)
    versions = (await s.execute(select(Asset).where(Asset.workspace_id == a.workspace_id, Asset.group_key == a.group_key,
                                                    Asset.group_key != "").order_by(Asset.version.desc()))).scalars().all() if a.group_key else []
    parents = []
    for k, v in (a.lineage or {}).items():
        if k.endswith("asset_id") and v:
            pa = await s.get(Asset, uuid.UUID(v))
            if pa and pa.workspace_id == p.workspace_id:
                parents.append({"role": k, **asset_out(pa)})
    out = asset_out(a)
    if a.kind in ("video_final", "video_animatic"):
        out["subtitles"] = (a.metadata_ or {}).get("subtitles")
    return {**out, "layout": a.layout, "versions": [asset_out(v) for v in versions], "parents": parents}


@router.get("/assets/{asset_id}/download", tags=["assets"])
async def download(asset_id: uuid.UUID, attachment: bool = False, p: Principal = Depends(current_principal),
                   s: AsyncSession = Depends(get_session)):
    a = await owned(s, p, Asset, asset_id)
    if a.deleted_at:
        raise AppError(410, "deleted", "This asset was deleted.")
    ext = a.storage_key.rsplit(".", 1)[-1]
    filename = f"{a.kind}-{a.preset or 'v' + str(a.version)}-{str(a.id)[:8]}.{ext}"
    disp = "attachment" if attachment else "inline"
    local = storage.local_path(a.storage_key)
    headers = {"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"}
    if local is not None:
        return FileResponse(local, media_type=a.mime_type, headers=headers, filename=filename, content_disposition_type=disp)
    data = await storage.get(a.storage_key)
    return Response(data, media_type=a.mime_type, headers={**headers, "Content-Disposition": f'{disp}; filename="{filename}"'})


@router.post("/assets/{asset_id}/approval", tags=["assets"])
async def set_approval(asset_id: uuid.UUID, body: S.ApprovalIn, p: Principal = Depends(require_editor),
                       s: AsyncSession = Depends(get_session)):
    a = await owned(s, p, Asset, asset_id)
    if body.state == "approved":
        q = a.quality or {}
        src_flags = any((r or {}).get("passed") is False for r in (q.get("source_reviews") or {}).values())
        if q.get("passed") is False or (q.get("background_review") or {}).get("passed") is False or q.get("claims") or src_flags:
            raise AppError(422, "unresolved_quality", "This asset has unresolved quality or fidelity findings and stays a draft.")
        if a.stale:
            raise AppError(422, "stale", "A stale asset cannot be approved.")
    a.approval_state = body.state
    await s.commit()
    return asset_out(a)


@router.delete("/assets/{asset_id}", tags=["assets"])
async def delete_asset(asset_id: uuid.UUID, p: Principal = Depends(require_editor), s: AsyncSession = Depends(get_session)):
    from datetime import UTC, datetime
    a = await owned(s, p, Asset, asset_id)
    if a.is_original:
        used = (await s.execute(text("select count(*) from product_assets where asset_id = :i"), {"i": a.id})).scalar_one()
        if used:
            raise AppError(409, "in_use", "Remove this upload from the product first.")
    a.deleted_at = datetime.now(UTC)
    await s.commit()
    await storage.delete(a.storage_key)
    return {"deleted": True, "note": "Deleted from LaunchLens storage. Provider-side copies follow the provider's retention policy."}


# ---------------------------------------------------------------- exports ----
@router.post("/projects/{project_id}/exports", tags=["exports"], status_code=202)
async def create_export(project_id: uuid.UUID, p: Principal = Depends(require_editor), s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    ex = Export(project_id=project_id, status="queued")
    s.add(ex)
    await s.commit()
    job, _ = await jobs.enqueue(workspace_id=p.workspace_id, project_id=project_id, kind="export", created_by=p.user_id,
                                payload={"export_id": str(ex.id)}, idempotency_key=f"export:{ex.id}")
    async with SessionLocal() as s2:
        e2 = await s2.get(Export, ex.id)
        e2.job_id = job.id
        await s2.commit()
    return {"export_id": str(ex.id), "job": job_out(job)}


@router.get("/projects/{project_id}/exports", tags=["exports"])
async def list_exports(project_id: uuid.UUID, p: Principal = Depends(current_principal), s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    rows = (await s.execute(select(Export).where(Export.project_id == project_id).order_by(Export.created_at.desc()).limit(30))).scalars().all()
    return {"items": [{"id": str(e.id), "status": e.status, "asset_id": str(e.asset_id) if e.asset_id else None,
                       "files": len((e.manifest or {}).get("files", [])), "included_versions": e.included_versions,
                       "download_url": f"/api/v1/assets/{e.asset_id}/download?attachment=true" if e.asset_id else None,
                       "expires_at": e.expires_at.isoformat() if e.expires_at else None,
                       "created_at": e.created_at.isoformat()} for e in rows]}


@router.get("/exports/{export_id}/manifest", tags=["exports"])
async def export_manifest(export_id: uuid.UUID, p: Principal = Depends(current_principal), s: AsyncSession = Depends(get_session)):
    e = await owned(s, p, Export, export_id)
    return e.manifest


# ---------------------------------------------------------------- results ----
def _result_out(r: CampaignResult) -> dict:
    return {"id": str(r.id), "period_start": r.period_start.isoformat(), "period_end": r.period_end.isoformat(),
            "area_name": r.area_name, "channel": r.channel, "impressions": r.impressions, "clicks": r.clicks,
            "inquiries": r.inquiries, "leads": r.leads, "purchases": r.purchases, "spend": num(r.spend), "currency": r.currency,
            "measurement_source": r.measurement_source, "notes": r.notes,
            "strategy_version_id": str(r.strategy_version_id) if r.strategy_version_id else None,
            "brief_id": str(r.brief_id) if r.brief_id else None, "placement_id": str(r.placement_id) if r.placement_id else None}


@router.post("/projects/{project_id}/results", tags=["results"], status_code=201)
async def import_results(project_id: uuid.UUID, body: S.ResultsIn, p: Principal = Depends(require_editor),
                         s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    for r in body.rows:
        if r.period_end < r.period_start:
            raise AppError(422, "bad_period", "period_end is before period_start.")
        s.add(CampaignResult(project_id=project_id, **r.model_dump()))
    await s.commit()
    return {"imported": len(body.rows)}


@router.post("/projects/{project_id}/results/csv", tags=["results"], status_code=201)
async def import_results_csv(project_id: uuid.UUID, file: UploadFile = File(...), p: Principal = Depends(require_editor),
                             s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    raw = (await file.read(2_000_001))
    if len(raw) > 2_000_000:
        raise AppError(413, "too_large", "CSV limited to 2 MB.")
    rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
    parsed = []
    for i, row in enumerate(rows[:500], start=2):
        clean = {k.strip(): (v.strip() if isinstance(v, str) else v) for k, v in row.items() if k}
        clean = {k: (None if v == "" else v) for k, v in clean.items()}
        try:
            parsed.append(S.ResultRow(**clean))
        except Exception as e:  # noqa: BLE001
            raise AppError(422, "csv_row_invalid", f"Row {i}: {str(e)[:300]}") from None
    return await import_results(project_id, S.ResultsIn(rows=parsed), p, s)


@router.get("/projects/{project_id}/results", tags=["results"])
async def results(project_id: uuid.UUID, p: Principal = Depends(current_principal), s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    rows = (await s.execute(select(CampaignResult).where(CampaignResult.project_id == project_id)
                            .order_by(CampaignResult.period_start))).scalars().all()
    groups: dict[str, dict] = {}
    for r in rows:
        g = groups.setdefault(f"{r.area_name} · {r.channel}", {"impressions": None, "clicks": None, "inquiries": None,
                                                                "leads": None, "purchases": None, "spend": None, "rows": 0})
        g["rows"] += 1
        for k in ("impressions", "clicks", "inquiries", "leads", "purchases"):
            v = getattr(r, k)
            if v is not None:
                g[k] = (g[k] or 0) + v
        if r.spend is not None:
            g["spend"] = float(g["spend"] or 0) + float(r.spend)
    summary = []
    for k, g in groups.items():
        rates = {}
        if g["impressions"] and g["clicks"] is not None:
            rates["click_through_rate"] = round(g["clicks"] / g["impressions"], 5)
        if g["clicks"] and g["inquiries"] is not None:
            rates["inquiries_per_click"] = round(g["inquiries"] / g["clicks"], 5)
        if g["inquiries"] and g["purchases"] is not None:
            rates["purchases_per_inquiry"] = round(g["purchases"] / g["inquiries"], 5)
        if g["spend"] and g["inquiries"]:
            rates["spend_per_inquiry"] = round(g["spend"] / g["inquiries"], 2)
        summary.append({"segment": k, **g, "rates": rates})
    svs = (await s.execute(select(StrategyVersion).where(StrategyVersion.project_id == project_id, StrategyVersion.stale.is_(False)))).scalars().all()
    hypotheses = [{"strategy": f"{sv.content.get('selected', {}).get('area_name')} × {sv.content.get('selected', {}).get('audience_name')}",
                   "kpis_to_test": sv.content.get("kpis_to_test", []), "feature_hypotheses": sv.content.get("feature_hypotheses", [])}
                  for sv in svs]
    return {"items": [_result_out(r) for r in rows], "summary": summary, "hypotheses": hypotheses,
            "limitations": ["Rates are computed only where a valid denominator exists; missing values stay unknown.",
                            "Pilot results are observational: no causal sales effect can be claimed from an uncontrolled before/after comparison.",
                            "Attribution depends on the measurement source of each row."]}


# ---------------------------------------------------------------- status -----
_status_cache: dict = {}


@router.get("/providers/status", tags=["meta"])
async def providers_status(refresh: bool = False, p: Principal = Depends(current_principal)):
    if not refresh and _status_cache.get("at", 0) > time.time() - 300:
        return _status_cache["data"]
    q, l_, x, g = await asyncio.gather(qloo.probe(), llm.probe(), media.probe(), geo.probe(), return_exceptions=True)

    def safe(v):
        return {"error": str(v)[:200]} if isinstance(v, Exception) else v
    data = {
        "qloo": {**safe(q), "base_url": settings.QLOO_BASE_URL},
        "reasoning": {**safe(l_), "primary": settings.LLM_PRIMARY_PROVIDER, "fallback": settings.LLM_FALLBACK_PROVIDER,
                      "fallback_configured": bool(settings.OPENROUTER_API_KEY)},
        "media": safe(x),
        "narration": {"configured": voice.configured(), "sarvam": bool(settings.SARVAM_API_KEY),
                      "fish": bool(settings.TTS_API_KEY), "fal": bool(settings.FAL_KEY),
                      "order": {"hi/bn": ["sarvam", "fish", "fal"], "en": ["fal", "fish"]},
                      "note": "Optional. Without it videos are delivered silent with captions."},
        "indic_language": {"provider": "Sarvam AI", "configured": bool(settings.SARVAM_API_KEY),
                           "translation_model": settings.SARVAM_TRANSLATE_MODEL, "tts_model": settings.SARVAM_TTS_MODEL,
                           "verified": "translate (hi-IN, bn-IN) and bulbul:v3 TTS verified 2026-10-08",
                           "note": "Brand names are protected during translation; translations are flagged for human review."},
        "geo": safe(g),
        "map": {"style_url": settings.MAP_STYLE_URL, "attribution": "© OpenStreetMap contributors, OpenFreeMap"},
        "storage": {"backend": settings.STORAGE_BACKEND},
        "limits": {"max_run_cost_usd": str(settings.MAX_RUN_COST_USD), "max_daily_cost_usd": str(settings.MAX_DAILY_COST_USD),
                   "demo_daily_cost_usd": str(settings.DEMO_DAILY_COST_USD), "max_video_seconds": settings.MAX_VIDEO_SECONDS,
                   "max_assets_per_batch": settings.MAX_ASSETS_PER_BATCH, "max_research_calls": settings.MAX_RESEARCH_CALLS},
        "checked_at": datetime.now(UTC).isoformat(),
        "legend": {"configured": "a credential is present", "reachable": "the provider answered",
                   "authorized": "the credential was accepted", "operations": "verified per operation"},
    }
    from ..services import plainstatus
    data["plain"] = plainstatus.build(data, data["checked_at"])
    _status_cache.update(at=time.time(), data=data)
    return data


@router.get("/usage", tags=["meta"])
async def usage(project_id: uuid.UUID | None = None, p: Principal = Depends(current_principal), s: AsyncSession = Depends(get_session)):
    if project_id:
        await check_project(s, p, project_id)
    data = await costs.summary(p.workspace_id, project_id)
    recent = (await s.execute(select(UsageLedger).where(UsageLedger.workspace_id == p.workspace_id)
                              .order_by(UsageLedger.created_at.desc()).limit(30))).scalars().all()
    data["recent"] = [{"provider": u.provider, "model": u.model, "operation": u.operation, "category": u.category,
                       "estimated_usd": num(u.estimated_usd), "actual_usd": num(u.actual_usd), "state": u.state,
                       "pricing_source": u.pricing_source, "created_at": u.created_at.isoformat()} for u in recent]
    return data


health = APIRouter()


@health.get("/health/live", tags=["meta"])
async def live():
    return {"status": "ok"}


@health.get("/health/ready", tags=["meta"])
async def ready():
    checks = {}
    try:
        async with SessionLocal() as s:
            await s.execute(text("select 1"))
            pg = (await s.execute(text("select postgis_lib_version()"))).scalar_one()
            checks["database"] = {"ok": True, "postgis": pg}
            last_hb = (await s.execute(select(func.max(Job.heartbeat_at)))).scalar_one()
            checks["worker_last_heartbeat"] = last_hb.isoformat() if last_hb else None
    except Exception as e:  # noqa: BLE001
        checks["database"] = {"ok": False, "error": type(e).__name__}
    import shutil
    checks["ffmpeg"] = {"ok": shutil.which(settings.FFMPEG_PATH) is not None}
    try:
        await storage.put("health/.probe", b"ok")
        checks["storage"] = {"ok": True}
    except Exception as e:  # noqa: BLE001
        checks["storage"] = {"ok": False, "error": type(e).__name__}
    checks["optional_providers"] = {"qloo": qloo.configured(), "media": media.configured(), "reasoning": llm.configured(),
                                    "narration": voice.configured()}
    ok = checks["database"]["ok"] and checks["ffmpeg"]["ok"] and checks["storage"]["ok"]
    return Response(content=__import__("json").dumps({"ready": ok, "checks": checks}), status_code=200 if ok else 503,
                    media_type="application/json")
