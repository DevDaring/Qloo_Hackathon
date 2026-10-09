"""Persisted progress events (the SSE stream reads these by id, so a client
that reconnects with Last-Event-ID misses nothing) and audit events."""
from __future__ import annotations

import uuid

from ..db import session_scope
from ..models import AuditEvent, RunEvent
from ..security import redact_obj


async def emit(workspace_id: uuid.UUID, type_: str, message: str = "", *, project_id: uuid.UUID | None = None,
               run_id: uuid.UUID | None = None, job_id: uuid.UUID | None = None, stage: str = "",
               data: dict | None = None) -> None:
    async with session_scope() as s:
        s.add(RunEvent(workspace_id=workspace_id, project_id=project_id, run_id=run_id, job_id=job_id, type=type_,
                       stage=stage, message=message[:2000], data=redact_obj(data or {})))


async def audit(workspace_id: uuid.UUID, action: str, *, user_id: uuid.UUID | None = None,
                project_id: uuid.UUID | None = None, target_type: str = "", target_id: str = "",
                details: dict | None = None) -> None:
    async with session_scope() as s:
        s.add(AuditEvent(workspace_id=workspace_id, user_id=user_id, project_id=project_id, action=action,
                         target_type=target_type, target_id=str(target_id), details=redact_obj(details or {})))
