"""Evidence model helpers.

Seven kinds are kept distinct everywhere: observed_fact, owner_fact,
provider_signal, derived_metric, hypothesis, synthetic_fixture, and data_gap
(an explicit "unknown": missing is not zero). Every material recommendation
cites evidence ids; `validate_refs` rejects ids that do not belong to the
project so a model cannot cite evidence that does not exist.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import EvidenceRecord

KINDS = ("observed_fact", "owner_fact", "provider_signal", "derived_metric", "hypothesis", "synthetic_fixture", "data_gap")
BADGE = {"observed_fact": "Supported", "owner_fact": "Owner-provided", "provider_signal": "Provider signal",
         "derived_metric": "Derived", "hypothesis": "Hypothesis", "synthetic_fixture": "Demo", "data_gap": "Unknown"}


def new(project_id: uuid.UUID, *, kind: str, topic: str, title: str, statement: str, source: str,
        run_id: uuid.UUID | None = None, area_id: uuid.UUID | None = None, audience_version_id: uuid.UUID | None = None,
        value: float | Decimal | None = None, units: str = "", source_ref: str = "", period: str = "",
        scope: dict | None = None, formula: str = "", inputs: list | None = None, limitations: str = "",
        payload: dict | None = None, status: str | None = None, retrieved_at: datetime | str | None = None,
        redistributable: bool = True, input_hash: str = "") -> EvidenceRecord:
    assert kind in KINDS, kind
    if status is None:
        status = {"hypothesis": "hypothesis", "synthetic_fixture": "demo", "data_gap": "unknown"}.get(kind, "supported")
    if isinstance(retrieved_at, str):
        retrieved_at = datetime.fromisoformat(retrieved_at)
    return EvidenceRecord(
        id=uuid.uuid4(), project_id=project_id, run_id=run_id, area_id=area_id, audience_version_id=audience_version_id,
        kind=kind, status=status, topic=topic, title=title[:300], statement=statement, source=source,
        value_numeric=Decimal(str(value)) if value is not None else None, units=units, source_ref=source_ref,
        period=period, scope=scope or {}, formula=formula, input_evidence_ids=[str(i) for i in (inputs or [])],
        limitations=limitations, payload=payload or {}, redistributable=redistributable,
        retrieved_at=retrieved_at or datetime.now(UTC), input_hash=input_hash)


async def validate_refs(s: AsyncSession, project_id: uuid.UUID, ids: list) -> tuple[list[str], list[str]]:
    """Split ids into (valid, invalid) for this project."""
    parsed: list[uuid.UUID] = []
    invalid: list[str] = []
    for i in ids or []:
        try:
            parsed.append(uuid.UUID(str(i)))
        except ValueError:
            invalid.append(str(i))
    if not parsed:
        return [], invalid
    found = set((await s.execute(select(EvidenceRecord.id).where(
        EvidenceRecord.project_id == project_id, EvidenceRecord.id.in_(parsed)))).scalars().all())
    valid = [str(i) for i in parsed if i in found]
    invalid += [str(i) for i in parsed if i not in found]
    return valid, invalid


def to_card(e: EvidenceRecord) -> dict:
    """The plain-language view shown in the evidence drawer."""
    return {
        "id": str(e.id), "kind": e.kind, "badge": BADGE.get(e.kind, e.kind), "status": e.status, "topic": e.topic,
        "title": e.title, "statement": e.statement, "source": e.source, "source_ref": e.source_ref,
        "retrieved_at": e.retrieved_at.isoformat() if e.retrieved_at else None, "period": e.period,
        "value": float(e.value_numeric) if e.value_numeric is not None else None, "units": e.units,
        "scope": e.scope, "formula": e.formula, "inputs": e.input_evidence_ids, "limitations": e.limitations,
        "area_id": str(e.area_id) if e.area_id else None, "run_id": str(e.run_id) if e.run_id else None,
        "redistributable": e.redistributable,
    }
