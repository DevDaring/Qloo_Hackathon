"""Spending control.

Every paid call reserves its estimated cost first, inside a transaction that
locks the workspace row, so concurrent jobs cannot each see headroom that only
exists once. After the call the reservation is committed at the actual cost
(when the provider reports it) or released. A submission whose outcome is
unknown keeps its reservation until it is reconciled.
"""
from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from functools import lru_cache
from pathlib import Path

from sqlalchemy import func, select

from ..config import settings
from ..db import session_scope
from ..errors import AppError
from ..models import UsageLedger, Workspace

ZERO = Decimal("0")


@lru_cache(maxsize=1)
def pricing() -> dict:
    p = Path(settings.PROVIDER_PRICING_FILE)
    if not p.exists():
        return {"entries": []}
    return json.loads(p.read_text())


def price(provider: str, model: str, unit: str) -> tuple[Decimal | None, str]:
    for e in pricing().get("entries", []):
        if e["provider"] == provider and e["model"] == model and e["unit"] == unit:
            if e.get("usd") is None:
                return None, e.get("source", "")
            return Decimal(str(e["usd"])), f'{e.get("source", "")} (effective {e.get("effective", "?")})'
    return None, "no pricing entry"


def _entry(provider: str, model: str, unit: str) -> dict:
    return next((e for e in pricing().get("entries", []) if e["provider"] == provider and e["model"] == model
                 and e["unit"] == unit), {})


def estimate(provider: str, model: str, unit: str, quantity: float) -> tuple[Decimal | None, str]:
    unit_price, src = price(provider, model, unit)
    if unit_price is None:
        return None, src
    return (unit_price * Decimal(str(quantity))).quantize(Decimal("0.000001")), src


def reservation(provider: str, model: str, unit: str, quantity: float) -> Decimal | None:
    """What to hold against the caps: the estimate times the entry's
    reserve_multiplier (headroom where observed charges exceeded list price)."""
    est, _ = estimate(provider, model, unit, quantity)
    if est is None:
        return None
    mult = Decimal(str(_entry(provider, model, unit).get("reserve_multiplier", 1)))
    return (est * mult).quantize(Decimal("0.000001"))


async def _spent_since(s, workspace_id: uuid.UUID, since: datetime, **filters) -> Decimal:
    amount = func.coalesce(UsageLedger.actual_usd, UsageLedger.estimated_usd)
    q = select(func.coalesce(func.sum(amount), 0)).where(
        UsageLedger.workspace_id == workspace_id, UsageLedger.state.in_(("reserved", "committed")),
        UsageLedger.created_at >= since)
    for k, v in filters.items():
        q = q.where(getattr(UsageLedger, k) == v)
    return Decimal(str((await s.execute(q)).scalar_one()))


async def reserve(*, workspace_id: uuid.UUID, project_id: uuid.UUID | None, job_id: uuid.UUID | None,
                  run_id: uuid.UUID | None, provider: str, model: str, operation: str, category: str,
                  quantity: float, unit: str, job_cap: Decimal | None = None,
                  allow_unknown_price: bool = False) -> UsageLedger:
    est, src = estimate(provider, model, unit, quantity)
    held = reservation(provider, model, unit, quantity)
    if held is not None:
        est = held
    if est is None and not allow_unknown_price:
        raise AppError(409, "cost_unknown",
                       f"No published price for {provider}/{model}; generation needs an explicit cap and approval.")
    est = est or ZERO
    day_start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    async with session_scope() as s:
        ws = (await s.execute(select(Workspace).where(Workspace.id == workspace_id).with_for_update())).scalar_one()
        daily_cap = min(Decimal(ws.daily_cost_cap_usd), settings.MAX_DAILY_COST_USD)
        if ws.is_demo:
            daily_cap = min(daily_cap, settings.DEMO_DAILY_COST_USD)
        spent_today = await _spent_since(s, workspace_id, day_start)
        if spent_today + est > daily_cap:
            raise AppError(402, "daily_cap_reached",
                           f"Daily spending cap of ${daily_cap} reached (${spent_today:.4f} used).",
                           details={"cap_usd": str(daily_cap), "spent_usd": str(spent_today)})
        if run_id is not None:
            run_spent = await _spent_since(s, workspace_id, day_start - timedelta(days=365), run_id=run_id)
            if run_spent + est > settings.MAX_RUN_COST_USD:
                raise AppError(402, "run_cap_reached", f"Run cap of ${settings.MAX_RUN_COST_USD} reached.")
        if job_id is not None and job_cap is not None:
            job_spent = await _spent_since(s, workspace_id, day_start - timedelta(days=365), job_id=job_id)
            if job_spent + est > job_cap:
                raise AppError(402, "job_cap_reached", f"This batch's cap of ${job_cap} would be exceeded.",
                               details={"cap_usd": str(job_cap), "spent_usd": str(job_spent)})
        row = UsageLedger(workspace_id=workspace_id, project_id=project_id, job_id=job_id, run_id=run_id,
                          provider=provider, model=model, operation=operation, category=category,
                          quantity=Decimal(str(quantity)), unit=unit, estimated_usd=est, pricing_source=src,
                          state="reserved")
        s.add(row)
        await s.flush()
        return row


async def settle(ledger_id: uuid.UUID, *, actual_usd: Decimal | None = None, attempt_id: uuid.UUID | None = None,
                 quantity: float | None = None) -> None:
    async with session_scope() as s:
        row = await s.get(UsageLedger, ledger_id, with_for_update=True)
        if row is None:
            return
        row.state = "committed"
        if actual_usd is not None:
            row.actual_usd = actual_usd
        if attempt_id:
            row.attempt_id = attempt_id
        if quantity is not None:
            row.quantity = Decimal(str(quantity))


async def release(ledger_id: uuid.UUID) -> None:
    async with session_scope() as s:
        row = await s.get(UsageLedger, ledger_id, with_for_update=True)
        if row and row.state == "reserved":
            row.state = "released"


async def record(*, workspace_id: uuid.UUID, project_id: uuid.UUID | None, provider: str, model: str,
                 operation: str, category: str, quantity: float, unit: str, actual_usd: Decimal | None = None,
                 job_id: uuid.UUID | None = None, run_id: uuid.UUID | None = None) -> None:
    """Record an already-completed cheap call (reasoning tokens, research)."""
    est, src = estimate(provider, model, unit, quantity)
    async with session_scope() as s:
        s.add(UsageLedger(workspace_id=workspace_id, project_id=project_id, job_id=job_id, run_id=run_id,
                          provider=provider, model=model, operation=operation, category=category,
                          quantity=Decimal(str(quantity)), unit=unit, estimated_usd=est or ZERO,
                          actual_usd=actual_usd, pricing_source=src, state="committed"))


async def summary(workspace_id: uuid.UUID, project_id: uuid.UUID | None = None) -> dict:
    async with session_scope() as s:
        q = select(UsageLedger.category, UsageLedger.state,
                   func.sum(UsageLedger.estimated_usd), func.sum(UsageLedger.actual_usd), func.count()).where(
            UsageLedger.workspace_id == workspace_id).group_by(UsageLedger.category, UsageLedger.state)
        if project_id:
            q = q.where(UsageLedger.project_id == project_id)
        out: dict[str, dict] = {}
        for cat, state, est, act, n in (await s.execute(q)).all():
            c = out.setdefault(cat, {"estimated_usd": ZERO, "actual_usd": ZERO, "reserved_usd": ZERO, "calls": 0})
            if state == "committed":
                c["estimated_usd"] += est or ZERO
                c["actual_usd"] += act or ZERO
            elif state == "reserved":
                c["reserved_usd"] += est or ZERO
            c["calls"] += n
        day_start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        today = await _spent_since(s, workspace_id, day_start)
        ws = await s.get(Workspace, workspace_id)
        cap = min(Decimal(ws.daily_cost_cap_usd), settings.MAX_DAILY_COST_USD)
        if ws.is_demo:
            cap = min(cap, settings.DEMO_DAILY_COST_USD)
    return {"by_category": {k: {kk: (str(vv) if isinstance(vv, Decimal) else vv) for kk, vv in v.items()}
                            for k, v in out.items()},
            "today_usd": str(today), "daily_cap_usd": str(cap), "currency": "USD"}
