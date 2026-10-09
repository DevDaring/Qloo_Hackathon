"""PostgreSQL-backed durable jobs.

Claims are atomic (UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED)),
leases expire and are recovered, heartbeats extend them, and every enqueue
carries an idempotency key unique per workspace. A job's provider attempts are
recorded in `provider_attempts` and committed before a paid call is sent,
which is what lets a restarted worker resume polling instead of paying twice.
"""
from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert

from ..config import settings
from ..db import session_scope
from ..models import Job, ProviderAttempt
from ..security import redact_obj
from . import events

log = logging.getLogger("launchlens.jobs")
TERMINAL = ("completed", "partially_completed", "failed", "cancelled")


class Cancelled(Exception):
    pass


class WaitingForUser(Exception):
    def __init__(self, decision: dict):
        super().__init__("waiting for user")
        self.decision = decision


async def enqueue(*, workspace_id: uuid.UUID, kind: str, payload: dict, idempotency_key: str,
                  project_id: uuid.UUID | None = None, run_id: uuid.UUID | None = None,
                  created_by: uuid.UUID | None = None, input_hash: str = "", max_attempts: int = 3,
                  deadline_s: int | None = None, cost_cap_usd: Decimal | None = None,
                  parent_job_id: uuid.UUID | None = None) -> tuple[Job, bool]:
    """Returns (job, created). Re-sending the same idempotency key returns the
    original job instead of creating a second one."""
    now = datetime.now(UTC)
    async with session_scope() as s:
        stmt = insert(Job).values(
            id=uuid.uuid4(), workspace_id=workspace_id, project_id=project_id, run_id=run_id, kind=kind,
            status="queued", payload=payload, idempotency_key=idempotency_key[:200], input_hash=input_hash,
            max_attempts=max_attempts, created_by=created_by, parent_job_id=parent_job_id,
            deadline_at=now + timedelta(seconds=deadline_s) if deadline_s else None, cost_cap_usd=cost_cap_usd,
            available_at=now, result={}, progress={}, attempts=0,
        ).on_conflict_do_nothing(index_elements=["workspace_id", "idempotency_key"]).returning(Job.id)
        new_id = (await s.execute(stmt)).scalar_one_or_none()
        job = (await s.execute(select(Job).where(Job.workspace_id == workspace_id,
                                                 Job.idempotency_key == idempotency_key[:200]))).scalar_one()
    if new_id:
        await events.emit(workspace_id, "job.queued", f"{kind} queued", project_id=project_id, run_id=run_id,
                          job_id=job.id, data={"kind": kind})
    return job, bool(new_id)


_CLAIM = text("""
UPDATE jobs SET status = 'running', lease_owner = :owner, attempts = attempts + 1,
       lease_expires_at = now() + make_interval(secs => :lease), heartbeat_at = now(), updated_at = now()
WHERE id = (
  SELECT id FROM jobs
  WHERE (status = 'queued' AND available_at <= now())
     OR (status IN ('running', 'waiting_for_provider') AND lease_expires_at < now())
     OR (status = 'cancellation_requested' AND (lease_expires_at IS NULL OR lease_expires_at < now()))
  ORDER BY available_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1)
RETURNING id
""")


async def claim(owner: str) -> Job | None:
    async with session_scope() as s:
        jid = (await s.execute(_CLAIM, {"owner": owner, "lease": settings.JOB_LEASE_SECONDS})).scalar_one_or_none()
        if jid is None:
            return None
        return await s.get(Job, jid)


async def heartbeat(job_id: uuid.UUID, owner: str, status: str | None = None, progress: dict | None = None) -> str:
    """Extend the lease. Returns the job's current status (to observe cancellation)."""
    async with session_scope() as s:
        values: dict = {"heartbeat_at": datetime.now(UTC), "updated_at": datetime.now(UTC),
                        "lease_expires_at": datetime.now(UTC) + timedelta(seconds=settings.JOB_LEASE_SECONDS)}
        job = await s.get(Job, job_id, with_for_update=True)
        if job is None:
            return "missing"
        if job.lease_owner != owner:
            return "lost_lease"
        if status and job.status not in ("cancellation_requested",) + TERMINAL:
            values["status"] = status
        if progress is not None:
            values["progress"] = {**(job.progress or {}), **progress}
        for k, v in values.items():
            setattr(job, k, v)
        return job.status


async def finish(job_id: uuid.UUID, status: str, *, result: dict | None = None, error: dict | None = None) -> None:
    assert status in TERMINAL + ("waiting_for_user", "queued"), status
    async with session_scope() as s:
        job = await s.get(Job, job_id, with_for_update=True)
        if job is None:
            return
        job.status = status
        job.lease_owner = None
        job.lease_expires_at = None
        if result is not None:
            job.result = redact_obj(result)
        if error is not None:
            job.error = redact_obj(error)
        if status in TERMINAL:
            job.finished_at = datetime.now(UTC)
        ws, pid, rid, kind = job.workspace_id, job.project_id, job.run_id, job.kind
    await events.emit(ws, f"job.{status}", f"{kind} {status.replace('_', ' ')}", project_id=pid, run_id=rid,
                      job_id=job_id, data={"kind": kind, "error": redact_obj(error) if error else None})


async def requeue(job_id: uuid.UUID, delay_s: float, reason: str) -> None:
    async with session_scope() as s:
        await s.execute(update(Job).where(Job.id == job_id).values(
            status="queued", lease_owner=None, lease_expires_at=None,
            available_at=datetime.now(UTC) + timedelta(seconds=delay_s), error={"last_retry_reason": reason}))


async def request_cancel(job_id: uuid.UUID) -> str:
    async with session_scope() as s:
        job = await s.get(Job, job_id, with_for_update=True)
        if job is None:
            return "missing"
        if job.status in TERMINAL:
            return job.status
        job.status = "cancelled" if job.status in ("queued", "waiting_for_user") else "cancellation_requested"
        if job.status == "cancelled":
            job.finished_at = datetime.now(UTC)
        return job.status


# ---------------------------------------------------------------- attempts --
async def prepare_attempt(*, job: Job, provider: str, operation: str, model: str, key: str,
                          request_summary: dict, reserved: Decimal) -> ProviderAttempt:
    """Write the attempt BEFORE sending. If one exists for this key, return it
    (the caller decides from its status whether to poll, reuse or stop)."""
    async with session_scope() as s:
        stmt = insert(ProviderAttempt).values(
            id=uuid.uuid4(), job_id=job.id, workspace_id=job.workspace_id, project_id=job.project_id,
            provider=provider, operation=operation, model=model, idempotency_key=key[:200], status="prepared",
            request_summary=redact_obj(request_summary), cost_reserved_usd=reserved, response_summary={},
            output_asset_ids=[],
        ).on_conflict_do_nothing(index_elements=["idempotency_key"])
        await s.execute(stmt)
        return (await s.execute(select(ProviderAttempt).where(ProviderAttempt.idempotency_key == key[:200]))).scalar_one()


async def find_attempt(key: str) -> ProviderAttempt | None:
    async with session_scope() as s:
        return (await s.execute(select(ProviderAttempt).where(ProviderAttempt.idempotency_key == key[:200]))).scalar_one_or_none()


async def update_attempt(attempt_id: uuid.UUID, **values) -> None:
    if "error" in values and values["error"]:
        values["error"] = redact_obj(values["error"])
    if "response_summary" in values:
        values["response_summary"] = redact_obj(values["response_summary"])
    async with session_scope() as s:
        await s.execute(update(ProviderAttempt).where(ProviderAttempt.id == attempt_id).values(**values))


async def attempts_for(job_id: uuid.UUID) -> list[ProviderAttempt]:
    async with session_scope() as s:
        return list((await s.execute(select(ProviderAttempt).where(ProviderAttempt.job_id == job_id)
                                     .order_by(ProviderAttempt.created_at))).scalars().all())


async def mark_interrupted_attempts_unknown(job_id: uuid.UUID) -> int:
    """On reclaim after a crash: a paid attempt left in 'prepared' may have been
    sent. Without a remote id it cannot be reconciled automatically."""
    async with session_scope() as s:
        res = await s.execute(update(ProviderAttempt).where(
            ProviderAttempt.job_id == job_id, ProviderAttempt.status == "prepared",
            ProviderAttempt.remote_request_id.is_(None)).values(
            status="submission_unknown",
            error={"kind": "submission_unknown",
                   "message": "The worker stopped after preparing this paid request; it may have been sent. "
                              "Check the provider console, then retry deliberately."}))
        return res.rowcount or 0
