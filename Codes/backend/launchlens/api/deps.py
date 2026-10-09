"""Shared API dependencies: ownership checks on every resource, rate limits
and small serialisers."""
from __future__ import annotations

import time
import uuid
from collections import defaultdict, deque
from decimal import Decimal

from fastapi import Depends, Request
from geoalchemy2.shape import to_shape
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..errors import AppError
from ..models import (
    Asset, CreativeBrief, Job, PlacementCandidate, Project, ResearchRun, StrategyVersion,
)
from ..security import Principal, current_principal


async def owned_project(project_id: uuid.UUID, p: Principal = Depends(current_principal),
                        s: AsyncSession = Depends(get_session)) -> Project:
    proj = await s.get(Project, project_id)
    if proj is None or proj.workspace_id != p.workspace_id:
        raise AppError(404, "not_found", "Project not found.")
    return proj


async def check_project(s: AsyncSession, p: Principal, project_id: uuid.UUID) -> Project:
    proj = await s.get(Project, project_id)
    if proj is None or proj.workspace_id != p.workspace_id:
        raise AppError(404, "not_found", "Not found.")
    return proj


async def owned(s: AsyncSession, p: Principal, model, obj_id: uuid.UUID):
    """Load any project-scoped row and enforce the caller's workspace."""
    obj = await s.get(model, obj_id)
    if obj is None:
        raise AppError(404, "not_found", "Not found.")
    ws = getattr(obj, "workspace_id", None)
    if ws is None:
        pid = getattr(obj, "project_id", None)
        if pid is None and isinstance(obj, CreativeBrief):
            pid = obj.project_id
        proj = await s.get(Project, pid) if pid else None
        ws = proj.workspace_id if proj else None
    if ws != p.workspace_id:
        raise AppError(404, "not_found", "Not found.")
    return obj


class RateLimiter:
    def __init__(self, limit: int, window_s: float):
        self.limit, self.window = limit, window_s
        self.hits: dict[str, deque] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = time.monotonic()
        q = self.hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            raise AppError(429, "rate_limited", "Too many requests; please wait a moment.", retryable=True)
        q.append(now)


login_limiter = RateLimiter(10, 300)
costly_limiter = RateLimiter(30, 600)
consult_limiter = RateLimiter(20, 300)


def client_ip(request: Request) -> str:
    return request.headers.get("x-real-ip") or (request.client.host if request.client else "unknown")


def num(v):
    if v is None:
        return None
    if isinstance(v, Decimal):
        return float(v)
    return v


def point(geom) -> dict | None:
    if geom is None:
        return None
    pt = to_shape(geom)
    if pt.geom_type != "Point":
        pt = pt.centroid
    return {"lat": round(pt.y, 6), "lon": round(pt.x, 6)}


def asset_out(a: Asset) -> dict:
    return {"id": str(a.id), "kind": a.kind, "mime_type": a.mime_type, "bytes": a.bytes, "width": a.width,
            "height": a.height, "duration_s": num(a.duration_s), "source": a.source, "label": a.label,
            "provider_model": a.provider_model, "remote_request_id": a.remote_request_id,
            "brief_id": str(a.brief_id) if a.brief_id else None, "preset": a.preset, "group_key": a.group_key,
            "version": a.version, "supersedes_id": str(a.supersedes_id) if a.supersedes_id else None,
            "approval_state": a.approval_state, "stale": a.stale, "stale_reason": a.stale_reason,
            "quality": a.quality, "lineage": a.lineage, "is_original": a.is_original, "sha256": a.sha256,
            "metadata": {k: v for k, v in (a.metadata_ or {}).items() if k != "subtitles"},
            "created_at": a.created_at.isoformat(), "url": f"/api/v1/assets/{a.id}/download"}


def job_out(j: Job) -> dict:
    return {"id": str(j.id), "kind": j.kind, "status": j.status, "attempts": j.attempts, "max_attempts": j.max_attempts,
            "progress": j.progress, "result": j.result, "error": j.error, "project_id": str(j.project_id) if j.project_id else None,
            "run_id": str(j.run_id) if j.run_id else None, "cost_cap_usd": num(j.cost_cap_usd),
            "created_at": j.created_at.isoformat(), "updated_at": j.updated_at.isoformat(),
            "finished_at": j.finished_at.isoformat() if j.finished_at else None,
            "heartbeat_at": j.heartbeat_at.isoformat() if j.heartbeat_at else None}


def run_out(r: ResearchRun) -> dict:
    return {"id": str(r.id), "project_id": str(r.project_id), "status": r.status, "stage": r.stage,
            "qloo_enabled": r.qloo_enabled, "experiment_label": r.experiment_label,
            "stage_statuses": r.stage_statuses, "counts": r.counts, "errors": r.errors,
            "pending_decision": r.pending_decision, "selections": r.selections,
            "previous_run_id": str(r.previous_run_id) if r.previous_run_id else None,
            "product_version_id": str(r.product_version_id) if r.product_version_id else None,
            "constraint_version_id": str(r.constraint_version_id) if r.constraint_version_id else None,
            "created_at": r.created_at.isoformat(), "updated_at": r.updated_at.isoformat()}


def placement_out(p: PlacementCandidate) -> dict:
    return {"id": str(p.id), "run_id": str(p.run_id), "area_id": str(p.area_id),
            "audience_version_id": str(p.audience_version_id) if p.audience_version_id else None,
            "place_id": str(p.place_id) if p.place_id else None, "channel_type": p.channel_type, "name": p.name,
            "category": p.category, "address": p.address, "location": point(p.geom), "source": p.source,
            "relationship_note": p.relationship_note, "qloo_relevance": p.qloo_relevance,
            "practical_evidence_ids": p.practical_evidence_ids, "activation": p.activation,
            "accessibility": p.accessibility, "verification": p.verification, "status": p.status,
            "shortlisted": p.shortlisted, "next_action": p.next_action, "evidence_needed": p.evidence_needed,
            "suitability_score": num(p.suitability_score), "owner_notes": p.owner_notes}


def strategy_out(sv: StrategyVersion) -> dict:
    return {"id": str(sv.id), "project_id": str(sv.project_id), "run_id": str(sv.run_id) if sv.run_id else None,
            "area_id": str(sv.area_id), "audience_version_id": str(sv.audience_version_id),
            "product_version_id": str(sv.product_version_id), "version": sv.version, "content": sv.content,
            "budget_scenario": sv.budget_scenario, "evidence_ids": sv.evidence_ids, "generator": sv.generator,
            "validation": sv.validation, "stale": sv.stale, "stale_reason": sv.stale_reason,
            "created_at": sv.created_at.isoformat()}


def brief_out(b: CreativeBrief) -> dict:
    return {"id": str(b.id), "lineage_id": str(b.lineage_id), "version": b.version, "project_id": str(b.project_id),
            "strategy_version_id": str(b.strategy_version_id), "product_version_id": str(b.product_version_id),
            "area_id": str(b.area_id), "audience_version_id": str(b.audience_version_id), "language": b.language,
            "channel": b.channel, "objective": b.objective, "angle": b.angle, "identity_hash": b.identity_hash,
            "content": b.content, "decisions": b.decisions, "approval_state": b.approval_state,
            "translation_status": b.translation_status, "lock_version": b.lock_version, "stale": b.stale,
            "stale_reason": b.stale_reason, "is_current": b.is_current, "created_at": b.created_at.isoformat(),
            "updated_at": b.updated_at.isoformat()}
