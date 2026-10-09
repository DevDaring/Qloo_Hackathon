"""Durable worker process: `python -m launchlens.worker.main`.

Claims PostgreSQL jobs atomically, heartbeats their leases in the background,
and runs them outside any web request. A job whose lease expires (worker
crash) is reclaimed by any worker; graph runs continue from their last
checkpoint and paid attempts are reconciled from the attempt ledger rather
than resubmitted. Disconnected browsers never cancel anything.
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal
import socket
import uuid
from datetime import UTC, datetime

from langgraph.types import Command

from ..config import settings
from ..db import session_scope
from ..errors import AppError
from ..graph import checkpoint, workflow
from ..models import Job, ResearchRun
from ..providers.base import ProviderError
from ..security import configure_logging, redact
from ..services import cache, creative, events, exporter, jobs, production
from ..services import context as ctxsvc

log = logging.getLogger("launchlens.worker")
OWNER = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:6]}"


class Ctx(production.JobCtx):
    """JobCtx whose cancellation flag is also set by the background heartbeat."""

    def __init__(self, job: Job, owner: str):
        super().__init__(job, owner)
        self.cancelled = False

    async def beat(self, status: str | None = None, **progress) -> None:
        if self.cancelled:
            raise jobs.Cancelled("cancellation requested")
        await super().beat(status, **progress)


async def _heartbeat_loop(ctx: Ctx) -> None:
    every = max(5, settings.JOB_LEASE_SECONDS // 4)
    while True:
        await asyncio.sleep(every)
        try:
            st = await jobs.heartbeat(ctx.job.id, ctx.owner)
            if st in ("cancellation_requested", "cancelled", "lost_lease"):
                ctx.cancelled = True
        except Exception as e:  # noqa: BLE001
            log.warning("heartbeat failed: %s", redact(str(e)))


# ---------------------------------------------------------------- handlers --
async def h_workflow(ctx: Ctx) -> tuple[str, dict]:
    job = ctx.job
    run_id = uuid.UUID(job.payload["run_id"])
    async with session_scope() as s:
        run = await s.get(ResearchRun, run_id)
        run.status = "running"
        thread_id, project_id, ws, qloo_enabled = run.thread_id, run.project_id, run.workspace_id, run.qloo_enabled
    async with checkpoint.saver() as cp:
        graph = workflow.build(cp)
        config = {"configurable": {"thread_id": thread_id, "job_ctx": ctx}, "recursion_limit": settings.MAX_AGENT_STEPS}
        snap = await graph.aget_state(config)
        if "resume" in job.payload and job.payload["resume"] is not None:
            inp = Command(resume=job.payload["resume"])
        elif not snap.values:
            inp = {"project_id": str(project_id), "run_id": str(run_id), "thread_id": thread_id, "tenant_id": str(ws),
                   "qloo_enabled": qloo_enabled, "stage_statuses": {}, "errors": [], "remote_request_ids": []}
        else:
            inp = None  # continue from the last checkpoint after an interruption
        await graph.ainvoke(inp, config)
        snap = await graph.aget_state(config)
    pending = [i.value for t in snap.tasks for i in (t.interrupts or [])]
    vals = snap.values or {}
    if pending:
        async with session_scope() as s:
            run = await s.get(ResearchRun, run_id)
            arm = run.experiment_label == "without_qloo"
            if arm and pending[0].get("type") == "select_targets":
                # an experiment arm only needs evaluation and placements; it never asks for targets or media
                run.status, run.pending_decision = "completed", None
        if arm and pending[0].get("type") == "select_targets":
            await events.emit(ws, "run.finished", "Comparison arm completed (evaluation and placements only)",
                              project_id=project_id, run_id=run_id, data={"experiment_arm": True})
            return "completed", {"experiment_arm": True}
        async with session_scope() as s:
            run = await s.get(ResearchRun, run_id)
            run.status, run.pending_decision = "waiting_for_user", pending[0]
        await events.emit(ws, "run.waiting", pending[0].get("title", "Waiting for your decision"), project_id=project_id,
                          run_id=run_id, data={"decision_type": pending[0].get("type")})
        return "waiting_for_user", {"pending_decision": pending[0].get("type")}
    errs = vals.get("errors") or []
    status = "partially_completed" if errs else "completed"
    async with session_scope() as s:
        run = await s.get(ResearchRun, run_id)
        run.status, run.pending_decision = status, None
        run.errors = errs
    await events.emit(ws, "run.finished", f"Run {status.replace('_', ' ')}", project_id=project_id, run_id=run_id,
                      data={"errors": len(errs), "export_id": vals.get("export_id")})
    return status, {"export_id": vals.get("export_id"), "errors": errs[:20]}


async def h_images(ctx: Ctx) -> tuple[str, dict]:
    p = ctx.job.payload
    r = await production.produce_images(ctx, uuid.UUID(p["brief_id"]), p.get("presets") or ["square"],
                                        nonce=p.get("nonce", ""), reuse_background_from=p.get("reuse_background_from"),
                                        crop_focus=p.get("crop_focus"))
    await production.quality_review(ctx, uuid.UUID(p["brief_id"]))
    status = "completed" if not r["failed"] else ("partially_completed" if r["created"] or r["reused"] else "failed")
    return status, r


async def h_video(ctx: Ctx) -> tuple[str, dict]:
    p = ctx.job.payload
    r = await production.produce_video(ctx, uuid.UUID(p["brief_id"]), orientations=p.get("orientations") or ["vertical"],
                                       mode=p.get("mode", "full"), narration=bool(p.get("narration")),
                                       nonce=p.get("nonce", ""), only_scene=p.get("only_scene"))
    await production.quality_review(ctx, uuid.UUID(p["brief_id"]))
    st = r.get("status")
    if st == "video_incomplete":
        return "failed", r
    return ("completed" if st == "completed" else "partially_completed"), r


async def h_brief(ctx: Ctx) -> tuple[str, dict]:
    p = ctx.job.payload
    c = await ctxsvc.load(ctx.job.project_id)
    src = await creative.current_brief(uuid.UUID(p["source_brief_id"])) if p.get("source_brief_id") else None
    r = await creative.create_brief(c, uuid.UUID(p["strategy_version_id"]), language=p.get("language", "en"),
                                    channel=p.get("channel", "social"), objective=p.get("objective", "inquiries"),
                                    angle=p.get("angle"), workspace_id=ctx.job.workspace_id, source_brief=src)
    return ("completed" if r.get("brief_id") else "failed"), r


async def h_export(ctx: Ctx) -> tuple[str, dict]:
    p = ctx.job.payload
    r = await exporter.build(ctx.job.project_id, ctx.job.workspace_id, uuid.UUID(p["export_id"]))
    return "completed", r


async def h_strategy(ctx: Ctx) -> tuple[str, dict]:
    from ..services import strategy
    p = ctx.job.payload
    c = await ctxsvc.load(ctx.job.project_id)
    aud = next((a for a in c["audiences"] if a["id"] == p["audience_version_id"]), None)
    if aud is None:
        return "failed", {"message": "Audience version is not current; re-run research for the new version."}
    r = await strategy.write(c, uuid.UUID(p["run_id"]), uuid.UUID(p["area_id"]), aud, workspace_id=ctx.job.workspace_id,
                             force=bool(p.get("force")))
    return ("completed" if r.get("strategy_version_id") else "failed"), r


HANDLERS = {"workflow": h_workflow, "images": h_images, "video": h_video, "brief": h_brief, "export": h_export,
            "strategy": h_strategy}


async def execute(job: Job) -> None:
    ctx = Ctx(job, job.lease_owner or OWNER)
    if job.status == "cancellation_requested":
        await jobs.finish(job.id, "cancelled", result={"message": "Cancelled before work resumed"})
        return
    if job.deadline_at and job.deadline_at < datetime.now(UTC):
        await jobs.finish(job.id, "failed", error={"kind": "deadline_exceeded", "message": "The job passed its deadline."})
        return
    if job.attempts > job.max_attempts:
        await jobs.finish(job.id, "failed", error={"kind": "attempts_exhausted",
                                                   "message": f"Stopped after {job.max_attempts} attempts."})
        return
    if job.attempts > 1:
        n = await jobs.mark_interrupted_attempts_unknown(job.id)
        if n:
            await events.emit(job.workspace_id, "job.reconcile", f"{n} paid request(s) need reconciliation",
                              project_id=job.project_id, job_id=job.id, run_id=job.run_id)
    hb = asyncio.create_task(_heartbeat_loop(ctx))
    try:
        await events.emit(job.workspace_id, "job.running", f"{job.kind} started (attempt {job.attempts})",
                          project_id=job.project_id, run_id=job.run_id, job_id=job.id)
        status, result = await HANDLERS[job.kind](ctx)
        await jobs.finish(job.id, status, result=result,
                          error=None if status in ("completed", "waiting_for_user") else {"kind": "partial", "detail": result})
    except jobs.Cancelled:
        await jobs.finish(job.id, "cancelled", result={"message": "Cancelled. Requests already submitted may still incur cost."})
        if job.run_id:
            async with session_scope() as s:
                run = await s.get(ResearchRun, job.run_id)
                if run:
                    run.status = "cancelled"
    except ProviderError as e:
        if e.retryable and job.attempts < job.max_attempts:
            await jobs.requeue(job.id, (e.retry_after or 10) * job.attempts, e.message)
        else:
            await jobs.finish(job.id, "failed", error=e.as_dict())
            await _fail_run(job, e.as_dict())
    except AppError as e:
        await jobs.finish(job.id, "failed", error={"kind": e.code, "message": e.message, "details": e.details})
        await _fail_run(job, {"kind": e.code, "message": e.message})
    except Exception as e:  # noqa: BLE001
        log.exception("job %s crashed", job.id)
        if job.attempts < job.max_attempts:
            await jobs.requeue(job.id, 15 * job.attempts, redact(repr(e))[:300])
        else:
            await jobs.finish(job.id, "failed", error={"kind": "internal", "message": redact(str(e))[:500]})
            await _fail_run(job, {"kind": "internal", "message": redact(str(e))[:300]})
    finally:
        hb.cancel()


async def _fail_run(job: Job, err: dict) -> None:
    if job.run_id and job.kind == "workflow":
        async with session_scope() as s:
            run = await s.get(ResearchRun, job.run_id)
            if run:
                run.status = "failed"
                run.errors = [*(run.errors or []), err]


async def reconcile_orphans() -> int:
    """Settle paid video submissions whose job ended before the result was
    collected (e.g. stopped by a cap or a crash): poll xAI once, keep the clip
    as a reusable asset if it finished, and commit or release the reservation."""
    from sqlalchemy import select

    from ..models import ProviderAttempt
    from ..providers import xai
    from ..services import assets as assetsvc
    from ..services import costs
    from ..security import fetch_media
    n = 0
    async with session_scope() as s:
        rows = (await s.execute(select(ProviderAttempt, Job).join(Job, Job.id == ProviderAttempt.job_id).where(
            ProviderAttempt.status == "submitted", ProviderAttempt.operation == "video_generation",
            ProviderAttempt.remote_request_id.isnot(None), Job.status.in_(jobs.TERMINAL)))).all()
    for att, job in rows:
        try:
            st = await xai.poll_video(att.remote_request_id)
        except ProviderError:
            continue
        ledger_id = (att.response_summary or {}).get("ledger_id")
        if st["state"] == "done":
            data, _ = await fetch_media(st["url"], 300_000_000, expected=("video/",))
            clip = await assetsvc.save(workspace_id=att.workspace_id, project_id=att.project_id, kind="video_clip", data=data,
                                       mime="video/mp4", source="xai", label="xAI clip (collected after its job ended)",
                                       provider_model=st.get("model") or att.model, remote_request_id=att.remote_request_id,
                                       input_hash=att.idempotency_key.split(":", 1)[-1][:64])
            await jobs.update_attempt(att.id, status="succeeded", cost_actual_usd=st.get("cost_usd"), output_asset_ids=[str(clip.id)])
            if ledger_id:
                await costs.settle(uuid.UUID(ledger_id), actual_usd=st.get("cost_usd"), attempt_id=att.id)
            n += 1
        elif st["state"] in ("failed", "expired"):
            await jobs.update_attempt(att.id, status="failed", error={"kind": "failed", "message": st.get("error")})
            if ledger_id:
                await costs.release(uuid.UUID(ledger_id))
            n += 1
    return n


async def loop(stop: asyncio.Event) -> None:
    sem = asyncio.Semaphore(settings.WORKER_CONCURRENCY)
    running: set[asyncio.Task] = set()
    last_purge = -1e9
    while not stop.is_set():
        await sem.acquire()
        try:
            job = await jobs.claim(OWNER)
        except Exception as e:  # noqa: BLE001 - database blip: back off, keep the loop alive
            sem.release()
            log.warning("claim failed: %s", redact(str(e)))
            await asyncio.sleep(5)
            continue
        if job is None:
            sem.release()
            now = asyncio.get_running_loop().time()
            if now - last_purge > 300:
                last_purge = now
                try:
                    await cache.purge_expired()
                    settled = await reconcile_orphans()
                    if settled:
                        log.info("reconciled %d orphaned paid submission(s)", settled)
                except Exception as e:  # noqa: BLE001
                    log.warning("housekeeping failed: %s", redact(str(e)))
            try:
                await asyncio.wait_for(stop.wait(), timeout=1.5)
            except TimeoutError:
                pass
            continue
        log.info("claimed %s %s (attempt %s)", job.kind, job.id, job.attempts)

        async def run_one(j=job):
            try:
                await execute(j)
            finally:
                sem.release()
        t = asyncio.create_task(run_one())
        running.add(t)
        t.add_done_callback(running.discard)
    if running:
        log.info("waiting for %d running job(s) to reach a safe point", len(running))
        await asyncio.wait(running, timeout=settings.JOB_LEASE_SECONDS)


async def main() -> None:
    configure_logging()
    await checkpoint.setup()
    stop = asyncio.Event()
    lp = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        lp.add_signal_handler(sig, stop.set)
    log.info("LaunchLens worker %s started (concurrency %d)", OWNER, settings.WORKER_CONCURRENCY)
    try:
        await loop(stop)
    finally:
        await checkpoint.close()


if __name__ == "__main__":
    asyncio.run(main())
