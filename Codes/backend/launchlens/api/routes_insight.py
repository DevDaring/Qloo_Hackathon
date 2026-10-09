"""Explanation and guidance views (read-only, no provider calls): taste story,
audience comparison, revision preview, creative trace, opportunities and the
project journey; plus duplicating a project (the way to edit the locked sample)."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..errors import AppError
from ..models import (
    Audience, AudienceVersion, Claim, ConstraintVersion, CreativeBrief, GeographicArea, ProductAsset, ProductFeature,
    ProductVersion, Project, ResearchRun, ResolvedEntity,
)
from ..security import Principal, current_principal, require_editor
from ..services import context as ctxsvc
from ..services import events, insight
from . import schemas as S
from .deps import check_project, owned

router = APIRouter(prefix="/api/v1")

MAX_PROJECTS_PER_WORKSPACE = 40


async def _run_area_audience(s, p, run_id, area_id, audience_ids) -> ResearchRun:
    run = await owned(s, p, ResearchRun, run_id)
    area = await s.get(GeographicArea, area_id)
    if area is None or area.project_id != run.project_id:
        raise AppError(404, "not_found", "That area is not part of this run's project.")
    snap_ids = {a["id"] for a in (run.input_snapshot or {}).get("audiences") or []}
    for a in audience_ids:
        if str(a) not in snap_ids:
            raise AppError(422, "audience_not_in_run", "That audience version was not part of this research run.",
                           fields={"audience_version_id": "not in the run's input snapshot"})
    return run


@router.get("/runs/{run_id}/taste-story", tags=["insight"])
async def taste_story(run_id: uuid.UUID, area_id: uuid.UUID, audience_version_id: uuid.UUID,
                      place_id: uuid.UUID | None = None, p: Principal = Depends(current_principal), s: AsyncSession = Depends(get_session)):
    """Feature A: selected interests → Qloo recommendations → shortlisted place →
    campaign hypothesis → creative preview. Every edge is typed and evidence-backed."""
    run = await _run_area_audience(s, p, run_id, area_id, [audience_version_id])
    return await insight.taste_story(s, run, area_id, audience_version_id, place_id=place_id)


@router.get("/runs/{run_id}/audience-compare", tags=["insight"])
async def audience_compare(run_id: uuid.UUID, area_id: uuid.UUID, a: uuid.UUID, b: uuid.UUID,
                           p: Principal = Depends(current_principal), s: AsyncSession = Depends(get_session)):
    if a == b:
        raise AppError(422, "same_audience", "Choose two different audiences.")
    run = await _run_area_audience(s, p, run_id, area_id, [a, b])
    return await insight.audience_compare(s, run, area_id, a, b)


@router.get("/runs/{run_id}/opportunities", tags=["insight"])
async def opportunities(run_id: uuid.UUID, p: Principal = Depends(current_principal), s: AsyncSession = Depends(get_session)):
    run = await owned(s, p, ResearchRun, run_id)
    return await insight.opportunities(s, run)


@router.post("/projects/{project_id}/revisions/preview", tags=["revisions"])
async def revision_preview(project_id: uuid.UUID, body: S.RevisionApplyIn, p: Principal = Depends(current_principal),
                           s: AsyncSession = Depends(get_session)):
    """Dry run of a revision: what would become stale or re-run. Writes nothing."""
    await check_project(s, p, project_id)
    return await insight.revision_preview(s, project_id, body)


@router.get("/creative-briefs/{brief_id}/trace", tags=["creative"])
async def creative_trace(brief_id: uuid.UUID, p: Principal = Depends(current_principal), s: AsyncSession = Depends(get_session)):
    """Feature D: copy → decisions → strategy → product facts and evidence, plus the pilot hypothesis card."""
    b = await owned(s, p, CreativeBrief, brief_id)
    return await insight.creative_trace(s, b)


@router.get("/projects/{project_id}/journey", tags=["projects"])
async def journey(project_id: uuid.UUID, p: Principal = Depends(current_principal), s: AsyncSession = Depends(get_session)):
    proj = await check_project(s, p, project_id)
    return await insight.journey(s, project_id, locked=proj.locked)


@router.post("/projects/{project_id}/duplicate", tags=["projects"], status_code=201)
async def duplicate_project(project_id: uuid.UUID, p: Principal = Depends(require_editor), s: AsyncSession = Depends(get_session)):
    """Copy the project's current inputs and decisions (product facts, claims,
    product media, constraints, audiences and their resolved interests) into a
    new editable project. Research results are not copied: running research on
    the copy reuses cached provider responses."""
    src = await check_project(s, p, project_id)
    n = (await s.execute(select(func.count()).select_from(Project).where(Project.workspace_id == p.workspace_id,
                                                                        Project.archived.is_(False)))).scalar_one()
    if n >= MAX_PROJECTS_PER_WORKSPACE:
        raise AppError(429, "too_many_projects", "This workspace has too many projects. Archive one first.")
    proj = Project(workspace_id=p.workspace_id, owner_id=p.user_id, name=f"{src.name} (my copy)"[:200], goal=src.goal,
                   country_code=src.country_code, currency=src.currency, status="ready_for_research", is_demo=False,
                   locked=False)
    s.add(proj)
    await s.flush()
    pv = await ctxsvc.latest_product(s, project_id)
    if pv:
        cols = {c: getattr(pv, c) for c in ("name", "description", "category", "price", "currency", "intended_benefits",
                                             "operating_limitations", "launch_date", "distribution_options", "available_stock",
                                             "brand_colours", "brand_voice", "website", "cta_destination", "open_questions",
                                             "is_synthetic", "source", "content_hash")}
        npv = ProductVersion(project_id=proj.id, version=1, change_note=f"Copied from {src.name} v{pv.version}", **cols)
        npv.features = [ProductFeature(position=f.position, key=f.key, name=f.name, mechanism=f.mechanism,
                                       proposed_benefit=f.proposed_benefit, operating_conditions=f.operating_conditions,
                                       evidence_status=f.evidence_status, source=f.source,
                                       prohibited_exaggerations=f.prohibited_exaggerations,
                                       critical_unknowns=f.critical_unknowns, enabled=f.enabled) for f in pv.features]
        s.add(npv)
        await s.flush()
        for c in (await s.execute(select(Claim).where(Claim.product_version_id == pv.id))).scalars().all():
            s.add(Claim(project_id=proj.id, product_version_id=npv.id, feature_key=c.feature_key, text=c.text,
                        support_status=c.support_status, approved=c.approved, evidence_ids=[]))
    for pa in (await s.execute(select(ProductAsset).where(ProductAsset.project_id == project_id))).scalars().all():
        # the media file itself is shared (immutable original); only the link is copied
        s.add(ProductAsset(project_id=proj.id, asset_id=pa.asset_id, role=pa.role, usage_rights=pa.usage_rights,
                           is_primary=pa.is_primary, extracted_text=pa.extracted_text))
    cv = await ctxsvc.latest_constraints(s, project_id)
    if cv:
        s.add(ConstraintVersion(project_id=proj.id, version=1, country_code=cv.country_code,
                                candidate_regions=cv.candidate_regions, service_regions=cv.service_regions,
                                excluded_regions=cv.excluded_regions, production_budget=cv.production_budget,
                                ad_spend_budget=cv.ad_spend_budget, currency=cv.currency,
                                min_ad_spend_per_location=cv.min_ad_spend_per_location,
                                distribution_requirements=cv.distribution_requirements, weights=cv.weights,
                                content_hash=cv.content_hash, change_note=f"Copied from {src.name} v{cv.version}"))
    for av in await ctxsvc.latest_audiences(s, project_id):
        aud = await s.get(Audience, av.audience_id)
        na = Audience(project_id=proj.id, key=aud.key)
        s.add(na)
        await s.flush()
        nav = AudienceVersion(audience_id=na.id, project_id=proj.id, version=1, name=av.name, role=av.role,
                              description=av.description, needs=av.needs, voluntary_interests=av.voluntary_interests,
                              languages=av.languages, research_notes=av.research_notes,
                              is_hypothetical_persona=av.is_hypothetical_persona, content_hash=av.content_hash)
        s.add(nav)
        await s.flush()
        for e in (await s.execute(select(ResolvedEntity).where(ResolvedEntity.audience_version_id == av.id))).scalars().all():
            s.add(ResolvedEntity(project_id=proj.id, audience_version_id=nav.id, query_text=e.query_text, status=e.status,
                                 qloo_id=e.qloo_id, qloo_type=e.qloo_type, canonical_name=e.canonical_name, tags=e.tags,
                                 candidates=e.candidates, proxy_for=e.proxy_for, proxy_reason=e.proxy_reason))
    await s.commit()
    await events.audit(p.workspace_id, "project.duplicate", user_id=p.user_id, project_id=proj.id,
                       details={"from": str(project_id)})
    from .routes_project import project_out
    return project_out(proj, {"copied_from": str(project_id),
                              "next": "Start research on your copy; cached provider data is reused."})
