"""Selective invalidation. Each change marks only dependent records stale and
writes a Revision saying what was invalidated, what was preserved and why.
Previous versions are never deleted.

  product facts/features -> strategies, briefs, media of that product version
  constraints            -> research must re-run (cached provider data is reused);
                            strategies are re-checked by input hash afterwards
  audience               -> that audience's strategies, briefs, media; its entities
  brief copy edit        -> composed flyers/videos re-render from existing
                            backgrounds and clips (no new generation)
"""
from __future__ import annotations

import uuid

from sqlalchemy import select, update

from ..db import session_scope
from ..models import Asset, CreativeBrief, Revision, StrategyVersion


async def _stale_briefs_and_media(s, brief_q, reason: str) -> tuple[list[str], list[str]]:
    briefs = (await s.execute(brief_q)).scalars().all()
    ids = [b.id for b in briefs]
    for b in briefs:
        b.stale, b.stale_reason = True, reason
    media = []
    if ids:
        rows = (await s.execute(select(Asset).where(Asset.brief_id.in_(ids), Asset.stale.is_(False),
                                                    Asset.kind.in_(("flyer", "video_final", "video_animatic"))))).scalars().all()
        for a in rows:
            a.stale, a.stale_reason = True, reason
            media.append(str(a.id))
    return [str(i) for i in ids], media


async def product_changed(project_id: uuid.UUID, user_id, before: dict, after: dict) -> dict:
    changed_feats = sorted({f["key"] for f in before.get("features", [])} ^ {f["key"] for f in after.get("features", [])} |
                           {f["key"] for f in after.get("features", []) for g in before.get("features", [])
                            if f["key"] == g["key"] and (f["enabled"] != g["enabled"] or f["proposed_benefit"] != g["proposed_benefit"])})
    reason = "Product facts changed" + (f" (features: {', '.join(changed_feats)})" if changed_feats else "")
    from . import profiles
    scoring_relevant = profiles.for_product(after).climate.feature_key in changed_feats
    async with session_scope() as s:
        svs = (await s.execute(select(StrategyVersion).where(StrategyVersion.project_id == project_id,
                                                             StrategyVersion.product_version_id == uuid.UUID(before["id"]),
                                                             StrategyVersion.stale.is_(False)))).scalars().all()
        for sv in svs:
            sv.stale, sv.stale_reason = True, reason
        briefs, media = await _stale_briefs_and_media(
            s, select(CreativeBrief).where(CreativeBrief.project_id == project_id,
                                           CreativeBrief.product_version_id == uuid.UUID(before["id"]),
                                           CreativeBrief.stale.is_(False)), reason)
        rev = Revision(project_id=project_id, user_id=user_id, kind="product", summary=reason,
                       before={"product_version": before["version"], "features": [(f["key"], f["enabled"]) for f in before["features"]]},
                       after={"product_version": after["version"], "features": [(f["key"], f["enabled"]) for f in after["features"]]},
                       invalidated={"strategies": [str(x.id) for x in svs], "briefs": briefs, "media": media,
                                    "research": "rerun_recommended" if scoring_relevant else "not_affected"},
                       preserved={"research": "Geographic research, places and climate evidence are unchanged" if not scoring_relevant
                                  else "Places and climate are reused from cache; only scoring re-runs",
                                  "previous_versions": "kept"})
        s.add(rev)
        await s.flush()
        return {"revision_id": str(rev.id), "summary": reason, "invalidated": rev.invalidated, "preserved": rev.preserved}


async def constraints_changed(project_id: uuid.UUID, user_id, before: dict | None, after: dict) -> dict:
    diffs = []
    if before:
        for k in ("candidate_regions", "service_regions", "excluded_regions", "ad_spend_budget", "production_budget",
                  "min_ad_spend_per_location", "distribution_requirements", "weights", "country_code"):
            if before.get(k) != after.get(k):
                diffs.append(k)
    summary = "Launch constraints changed: " + (", ".join(diffs) if diffs else "initial version")
    async with session_scope() as s:
        rev = Revision(project_id=project_id, user_id=user_id, kind="constraint", summary=summary,
                       before=before or {}, after=after,
                       invalidated={"research": "rerun_required" if diffs else "first_run",
                                    "strategies": "re-checked by input hash after the new run; unchanged pairs are reused"},
                       preserved={"provider_cache": "Places, climate and Qloo responses are reused when the query is unchanged",
                                  "previous_runs": "kept for comparison"})
        s.add(rev)
        await s.flush()
        return {"revision_id": str(rev.id), "summary": summary, "changed": diffs}


async def audience_changed(project_id: uuid.UUID, user_id, before: dict, after: dict) -> dict:
    reason = f"Audience '{before['name']}' changed (v{before['version']} → v{after['version']})"
    async with session_scope() as s:
        svs = (await s.execute(select(StrategyVersion).where(StrategyVersion.audience_version_id == uuid.UUID(before["id"]),
                                                             StrategyVersion.stale.is_(False)))).scalars().all()
        for sv in svs:
            sv.stale, sv.stale_reason = True, reason
        briefs, media = await _stale_briefs_and_media(
            s, select(CreativeBrief).where(CreativeBrief.audience_version_id == uuid.UUID(before["id"]),
                                           CreativeBrief.stale.is_(False)), reason)
        rev = Revision(project_id=project_id, user_id=user_id, kind="audience", summary=reason,
                       before={"audience_version": before}, after={"audience_version": after},
                       invalidated={"strategies": [str(x.id) for x in svs], "briefs": briefs, "media": media,
                                    "taste_signals": "re-query for this audience"},
                       preserved={"other_audiences": "untouched", "places_and_climate": "reused"})
        s.add(rev)
        await s.flush()
        return {"revision_id": str(rev.id), "summary": reason, "invalidated": rev.invalidated}


async def brief_edited(project_id: uuid.UUID, user_id, old: CreativeBrief, new: CreativeBrief) -> dict:
    copy_changed = old.copy_hash != new.copy_hash
    visual_changed = old.visual_hash != new.visual_hash
    reason = f"Brief edited v{old.version} → v{new.version}" + (" (copy)" if copy_changed else "") + (" (visuals)" if visual_changed else "")
    async with session_scope() as s:
        media = []
        if copy_changed or visual_changed:
            rows = (await s.execute(select(Asset).where(Asset.brief_id == old.id, Asset.stale.is_(False),
                                                        Asset.kind.in_(("flyer", "video_final", "video_animatic"))))).scalars().all()
            for a in rows:
                a.stale, a.stale_reason = True, reason
                media.append(str(a.id))
        if visual_changed:
            await s.execute(update(Asset).where(Asset.brief_id == old.id, Asset.kind.in_(("background", "scene_frame")))
                            .values(stale=True, stale_reason=reason))
        rev = Revision(project_id=project_id, user_id=user_id, kind="copy" if not visual_changed else "creative",
                       summary=reason, before={"brief_id": str(old.id), "copy_hash": old.copy_hash},
                       after={"brief_id": str(new.id), "copy_hash": new.copy_hash},
                       invalidated={"media": media, "backgrounds": "regenerate" if visual_changed else "kept"},
                       preserved={"research": "not affected", "strategy": "not affected",
                                  "backgrounds_and_clips": "reused for re-rendering" if not visual_changed else "replaced on next generation"})
        s.add(rev)
        await s.flush()
        return {"revision_id": str(rev.id), "summary": reason, "invalidated": rev.invalidated, "preserved": rev.preserved}
