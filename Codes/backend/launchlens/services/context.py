"""Loads a project's current versions as plain dicts for the workflow, so no
ORM object outlives its session and no transaction spans a provider call."""
from __future__ import annotations

import uuid

from sqlalchemy import select

from ..db import session_scope
from ..models import (
    Audience, AudienceVersion, Claim, ConstraintVersion, ProductAsset, ProductVersion, Project, ResolvedEntity,
)
from . import hashing


def product_dict(pv: ProductVersion) -> dict:
    return {
        "id": str(pv.id), "version": pv.version, "name": pv.name, "description": pv.description,
        "category": pv.category, "price": float(pv.price) if pv.price is not None else None, "currency": pv.currency,
        "intended_benefits": pv.intended_benefits, "operating_limitations": pv.operating_limitations,
        "launch_date": pv.launch_date.isoformat() if pv.launch_date else None,
        "distribution_options": pv.distribution_options, "available_stock": pv.available_stock,
        "brand_colours": pv.brand_colours, "brand_voice": pv.brand_voice, "website": pv.website,
        "cta_destination": pv.cta_destination, "open_questions": pv.open_questions, "is_synthetic": pv.is_synthetic,
        "features": [{"key": f.key, "name": f.name, "mechanism": f.mechanism, "proposed_benefit": f.proposed_benefit,
                      "operating_conditions": f.operating_conditions, "evidence_status": f.evidence_status,
                      "source": f.source, "prohibited_exaggerations": f.prohibited_exaggerations,
                      "critical_unknowns": f.critical_unknowns, "enabled": f.enabled} for f in pv.features],
        "hash": hashing.product_hash(pv),
    }


def audience_dict(av: AudienceVersion) -> dict:
    return {"id": str(av.id), "audience_id": str(av.audience_id), "version": av.version, "name": av.name,
            "role": av.role, "description": av.description, "needs": av.needs,
            "voluntary_interests": av.voluntary_interests, "languages": av.languages,
            "research_notes": av.research_notes, "is_hypothetical_persona": av.is_hypothetical_persona,
            "hash": hashing.audience_hash(av)}


def constraint_dict(cv: ConstraintVersion) -> dict:
    return {"id": str(cv.id), "version": cv.version, "country_code": cv.country_code,
            "candidate_regions": cv.candidate_regions, "service_regions": cv.service_regions,
            "excluded_regions": cv.excluded_regions,
            "production_budget": float(cv.production_budget) if cv.production_budget is not None else None,
            "ad_spend_budget": float(cv.ad_spend_budget) if cv.ad_spend_budget is not None else None,
            "currency": cv.currency,
            "min_ad_spend_per_location": float(cv.min_ad_spend_per_location) if cv.min_ad_spend_per_location is not None else None,
            "distribution_requirements": cv.distribution_requirements, "weights": cv.weights,
            "hash": hashing.constraint_hash(cv)}


async def latest_product(s, project_id: uuid.UUID) -> ProductVersion | None:
    return (await s.execute(select(ProductVersion).where(ProductVersion.project_id == project_id)
                            .order_by(ProductVersion.version.desc()).limit(1))).scalar_one_or_none()


async def latest_constraints(s, project_id: uuid.UUID) -> ConstraintVersion | None:
    return (await s.execute(select(ConstraintVersion).where(ConstraintVersion.project_id == project_id)
                            .order_by(ConstraintVersion.version.desc()).limit(1))).scalar_one_or_none()


async def latest_audiences(s, project_id: uuid.UUID) -> list[AudienceVersion]:
    auds = (await s.execute(select(Audience).where(Audience.project_id == project_id, Audience.archived.is_(False))
                            .order_by(Audience.created_at))).scalars().all()
    out = []
    for a in auds:
        av = (await s.execute(select(AudienceVersion).where(AudienceVersion.audience_id == a.id)
                              .order_by(AudienceVersion.version.desc()).limit(1))).scalar_one_or_none()
        if av:
            out.append(av)
    return out


async def load(project_id: uuid.UUID) -> dict:
    async with session_scope() as s:
        project = await s.get(Project, project_id)
        pv = await latest_product(s, project_id)
        cv = await latest_constraints(s, project_id)
        avs = await latest_audiences(s, project_id)
        claims = (await s.execute(select(Claim).where(Claim.project_id == project_id,
                                                      Claim.product_version_id == (pv.id if pv else None)))).scalars().all()
        ents = (await s.execute(select(ResolvedEntity).where(ResolvedEntity.project_id == project_id))).scalars().all()
        passets = (await s.execute(select(ProductAsset).where(ProductAsset.project_id == project_id))).scalars().all()
        return {
            "project": {"id": str(project.id), "workspace_id": str(project.workspace_id), "name": project.name,
                        "country_code": project.country_code, "currency": project.currency, "is_demo": project.is_demo},
            "product": product_dict(pv) if pv else None,
            "constraints": constraint_dict(cv) if cv else None,
            "audiences": [audience_dict(a) for a in avs],
            "claims": [{"id": str(c.id), "text": c.text, "feature_key": c.feature_key, "support_status": c.support_status,
                        "approved": c.approved} for c in claims],
            "entities": [{"id": str(e.id), "audience_version_id": str(e.audience_version_id) if e.audience_version_id else None,
                          "query_text": e.query_text, "status": e.status, "qloo_id": e.qloo_id, "qloo_type": e.qloo_type,
                          "canonical_name": e.canonical_name, "candidates": e.candidates, "proxy_for": e.proxy_for,
                          "tags": e.tags} for e in ents],
            "product_assets": [{"asset_id": str(a.asset_id), "role": a.role, "is_primary": a.is_primary} for a in passets],
        }


SNAPSHOT_KEYS = ("project", "product", "constraints", "audiences", "claims", "entities", "product_assets")


async def load_for_run(run_id: uuid.UUID) -> dict:
    """The run's frozen inputs. A run (and any experiment arm copied from it)
    always works from the snapshot taken when it started, so later edits to
    the project cannot change what the run computes. Runs created before full
    snapshots existed fall back to live data for the missing keys."""
    from ..models import ResearchRun
    async with session_scope() as s:
        run = await s.get(ResearchRun, run_id)
        snap = dict(run.input_snapshot or {})
        project_id = run.project_id
    if all(k in snap for k in SNAPSHOT_KEYS):
        return {k: snap[k] for k in SNAPSHOT_KEYS} | {"runtime": snap.get("runtime", {})}
    live = await load(project_id)
    return {k: snap.get(k, live.get(k)) for k in SNAPSHOT_KEYS} | {"runtime": snap.get("runtime", {})}


async def freeze_entities(run_id: uuid.UUID) -> list[dict]:
    """After entity resolution (including human decisions), copy the decided
    signals for the run's audience versions into the run snapshot."""
    from ..models import ResearchRun
    async with session_scope() as s:
        run = await s.get(ResearchRun, run_id, with_for_update=True)
        aud_ids = [uuid.UUID(a["id"]) for a in (run.input_snapshot or {}).get("audiences", [])]
        rows = (await s.execute(select(ResolvedEntity).where(ResolvedEntity.project_id == run.project_id,
                                                             ResolvedEntity.audience_version_id.in_(aud_ids)))).scalars().all()
        ents = [{"id": str(e.id), "audience_version_id": str(e.audience_version_id) if e.audience_version_id else None,
                 "query_text": e.query_text, "status": e.status, "qloo_id": e.qloo_id, "qloo_type": e.qloo_type,
                 "canonical_name": e.canonical_name, "candidates": e.candidates, "proxy_for": e.proxy_for,
                 "proxy_reason": e.proxy_reason, "tags": e.tags} for e in rows]
        run.input_snapshot = {**(run.input_snapshot or {}), "entities": ents}
    return ents


def signals_from(entities: list[dict], audience_version_id: str | None = None) -> tuple[list[str], list[str]]:
    """Approved Qloo signals (resolved or explicit proxies) from a snapshot."""
    rows = [e for e in entities or [] if e.get("status") in ("resolved", "proxy") and e.get("qloo_id")
            and (audience_version_id is None or e.get("audience_version_id") == audience_version_id)]
    ents = sorted({e["qloo_id"] for e in rows if not (e.get("qloo_type") or "").startswith("urn:tag")})
    tags = sorted({e["qloo_id"] for e in rows if (e.get("qloo_type") or "").startswith("urn:tag")})
    return ents[:10], tags[:10]


def runtime_info() -> dict:
    """Configuration that can confound comparisons between runs."""
    import hashlib
    from pathlib import Path

    from ..config import settings
    from ..providers import llm
    pricing = Path(settings.PROVIDER_PRICING_FILE)
    return {"reasoning_primary": llm.primary_model(),
            "reasoning_fallback": (f"{settings.LLM_FALLBACK_PROVIDER}" if settings.LLM_ALLOW_FALLBACK else None),
            "xai_text_model": settings.XAI_TEXT_MODEL, "media_provider": settings.MEDIA_PROVIDER,
            "image_model": settings.NANOGPT_IMAGE_MODEL if settings.MEDIA_PROVIDER == "nanogpt" else settings.XAI_IMAGE_MODEL,
            "video_model": settings.NANOGPT_VIDEO_MODEL if settings.MEDIA_PROVIDER == "nanogpt" else settings.XAI_VIDEO_MODEL, "qloo_base_url": settings.QLOO_BASE_URL,
            "translate_model": settings.SARVAM_TRANSLATE_MODEL,
            "pricing_sha256": hashlib.sha256(pricing.read_bytes()).hexdigest()[:16] if pricing.exists() else None,
            "max_run_cost_usd": str(settings.MAX_RUN_COST_USD)}


async def refresh_snapshot(run_id: uuid.UUID) -> None:
    """Re-take the snapshot (only before any research has happened, e.g. after
    the owner fixes intake problems and resumes)."""
    from ..models import ResearchRun
    async with session_scope() as s:
        run = await s.get(ResearchRun, run_id)
        project_id = run.project_id
    live = await load(project_id)
    async with session_scope() as s:
        run = await s.get(ResearchRun, run_id, with_for_update=True)
        run.input_snapshot = {**(run.input_snapshot or {}), **{k: live[k] for k in SNAPSHOT_KEYS},
                              "runtime": runtime_info()}
