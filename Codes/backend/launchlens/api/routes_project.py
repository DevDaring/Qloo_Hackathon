"""Auth, projects, product versions, claims, uploads, audiences, entities,
constraints, geo search and saved areas."""
from __future__ import annotations

import io
import uuid
from datetime import UTC, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile
from geoalchemy2.shape import from_shape, to_shape
from PIL import Image
from pydantic import BaseModel, Field
from shapely.geometry import Point, Polygon
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import get_session
from ..errors import AppError
from ..models import (
    Asset, Audience, AudienceVersion, Claim, ConstraintVersion, CreativeBrief, GeographicArea, Job, Membership,
    ProductAsset, ProductFeature, ProductVersion, Project, ResearchRun, ResolvedEntity, StrategyVersion, User, Workspace,
)
from ..providers import geo, llm, qloo
from ..providers.base import ProviderError
from ..security import COOKIE_NAME, Principal, current_principal, issue_token, require_editor, verify_password
from ..services import assets as assetsvc
from ..services import context as ctxsvc
from ..services import events, hashing, insight, revisions
from . import schemas as S
from .deps import asset_out, check_project, client_ip, login_limiter, num, owned, point

router = APIRouter(prefix="/api/v1")


# ---------------------------------------------------------------- auth -------
@router.post("/auth/login", tags=["auth"])
async def login(body: S.LoginIn, request: Request, response: Response, s: AsyncSession = Depends(get_session)):
    login_limiter.check(client_ip(request))
    user = (await s.execute(select(User).where(func.lower(User.username) == body.username.lower()))).scalar_one_or_none()
    if user is None or not user.is_active or not verify_password(body.password, user.password_hash):
        raise AppError(401, "invalid_credentials", "Username or password is incorrect.")
    m = (await s.execute(select(Membership).where(Membership.user_id == user.id))).scalars().first()
    if m is None:
        raise AppError(403, "no_workspace", "This account has no workspace.")
    user.last_login_at = datetime.now(UTC)
    await s.commit()
    token = issue_token(user.id, m.workspace_id)
    response.set_cookie(COOKIE_NAME, token, httponly=True, secure=settings.SESSION_COOKIE_SECURE, samesite="lax",
                        max_age=settings.SESSION_TTL_HOURS * 3600, path="/")
    await events.audit(m.workspace_id, "login", user_id=user.id)
    return {"ok": True, "user": {"id": str(user.id), "username": user.username, "display_name": user.display_name}}


@router.post("/auth/logout", tags=["auth"])
async def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/auth/me", tags=["auth"])
async def me(p: Principal = Depends(current_principal), s: AsyncSession = Depends(get_session)):
    ws = await s.get(Workspace, p.workspace_id)
    user = await s.get(User, p.user_id)
    return {"user": {"id": str(p.user_id), "username": p.username, "display_name": user.display_name},
            "workspace": {"id": str(ws.id), "name": ws.name, "is_demo": ws.is_demo, "role": p.role}}


@router.get("/public-config", tags=["meta"])
async def public_config():
    return settings.public_config()


# ---------------------------------------------------------------- projects ---
def project_out(p: Project, extra: dict | None = None) -> dict:
    return {"id": str(p.id), "name": p.name, "goal": p.goal, "status": p.status, "country_code": p.country_code,
            "currency": p.currency, "is_demo": p.is_demo, "locked": p.locked, "archived": p.archived, "saved_map_state": p.saved_map_state,
            "created_at": p.created_at.isoformat(), "updated_at": p.updated_at.isoformat(), **(extra or {})}


@router.get("/projects", tags=["projects"])
async def list_projects(include_archived: bool = False, p: Principal = Depends(current_principal),
                        s: AsyncSession = Depends(get_session)):
    q = select(Project).where(Project.workspace_id == p.workspace_id).order_by(Project.updated_at.desc())
    if not include_archived:
        q = q.where(Project.archived.is_(False))
    out = []
    for proj in (await s.execute(q)).scalars().all():
        last_run = (await s.execute(select(ResearchRun).where(ResearchRun.project_id == proj.id)
                                    .order_by(ResearchRun.created_at.desc()).limit(1))).scalar_one_or_none()
        recent = (await s.execute(select(Asset).where(Asset.project_id == proj.id, Asset.kind.in_(("flyer", "video_final")),
                                                      Asset.deleted_at.is_(None)).order_by(Asset.created_at.desc()).limit(4))).scalars().all()
        n_strat = (await s.execute(select(func.count()).select_from(StrategyVersion).where(StrategyVersion.project_id == proj.id))).scalar_one()
        photo = (await s.execute(select(ProductAsset).where(ProductAsset.project_id == proj.id,
                                                            ProductAsset.role == "product_photo")
                                 .order_by(ProductAsset.is_primary.desc()).limit(1))).scalar_one_or_none()
        jr = await insight.journey(s, proj.id, locked=proj.locked)
        out.append(project_out(proj, {"last_run": {"id": str(last_run.id), "status": last_run.status, "stage": last_run.stage}
                                      if last_run else None,
                                      "recent_outputs": [asset_out(a) for a in recent], "strategies": n_strat,
                                      "thumbnail_url": f"/api/v1/assets/{photo.asset_id}/download" if photo else None,
                                      "journey": {"current": jr["current"], "last_completed": jr["last_completed"],
                                                  "stages": [{"key": x["key"], "status": x["status"]} for x in jr["stages"]],
                                                  "next_action": jr["next_action"]}}))
    return {"items": out}


@router.post("/projects", tags=["projects"], status_code=201)
async def create_project(body: S.ProjectIn, p: Principal = Depends(require_editor), s: AsyncSession = Depends(get_session)):
    proj = Project(workspace_id=p.workspace_id, owner_id=p.user_id, name=body.name, goal=body.goal,
                   country_code=body.country_code.upper(), currency=body.currency.upper(), status="draft")
    s.add(proj)
    await s.commit()
    await events.audit(p.workspace_id, "project.create", user_id=p.user_id, project_id=proj.id)
    return project_out(proj)


@router.get("/projects/{project_id}", tags=["projects"])
async def get_project(project_id: uuid.UUID, p: Principal = Depends(current_principal), s: AsyncSession = Depends(get_session)):
    proj = await check_project(s, p, project_id)
    ctx = await ctxsvc.load(project_id)
    counts = await assetsvc.count_for_project(project_id)
    runs = (await s.execute(select(ResearchRun).where(ResearchRun.project_id == project_id)
                            .order_by((ResearchRun.experiment_label != "").asc(), ResearchRun.created_at.desc())
                            .limit(10))).scalars().all()
    n_briefs = (await s.execute(select(func.count()).select_from(CreativeBrief).where(
        CreativeBrief.project_id == project_id, CreativeBrief.is_current.is_(True)))).scalar_one()
    active_jobs = (await s.execute(select(func.count()).select_from(Job).where(
        Job.project_id == project_id, Job.status.in_(("queued", "running", "waiting_for_provider"))))).scalar_one()
    return project_out(proj, {"product": ctx["product"], "constraints": ctx["constraints"], "audiences": ctx["audiences"],
                              "claims": ctx["claims"], "product_assets": ctx["product_assets"], "asset_counts": counts,
                              "runs": [{"id": str(r.id), "status": r.status, "stage": r.stage, "qloo_enabled": r.qloo_enabled,
                                        "experiment_label": r.experiment_label, "created_at": r.created_at.isoformat()} for r in runs],
                              "briefs": n_briefs, "active_jobs": active_jobs})


@router.patch("/projects/{project_id}", tags=["projects"])
async def update_project(project_id: uuid.UUID, body: S.ProjectPatch, p: Principal = Depends(require_editor),
                         s: AsyncSession = Depends(get_session)):
    proj = await check_project(s, p, project_id)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(proj, k, v)
    await s.commit()
    return project_out(proj)


@router.put("/projects/{project_id}/map-state", tags=["projects"])
async def save_map_state(project_id: uuid.UUID, state: dict, p: Principal = Depends(require_editor),
                         s: AsyncSession = Depends(get_session)):
    proj = await check_project(s, p, project_id)
    if proj.locked:  # the shared sample keeps its saved view; visitors' panning is not persisted
        return {"saved": proj.saved_map_state, "persisted": False}
    proj.saved_map_state = {k: state[k] for k in ("center", "zoom", "filters", "run_id", "area_id", "view") if k in state}
    await s.commit()
    return {"saved": proj.saved_map_state}


# ---------------------------------------------------------------- product ----
@router.get("/projects/{project_id}/product", tags=["product"])
async def get_product(project_id: uuid.UUID, p: Principal = Depends(current_principal), s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    versions = (await s.execute(select(ProductVersion).where(ProductVersion.project_id == project_id)
                                .order_by(ProductVersion.version.desc()))).scalars().all()
    return {"current": ctxsvc.product_dict(versions[0]) if versions else None,
            "versions": [{"id": str(v.id), "version": v.version, "created_at": v.created_at.isoformat(),
                          "change_note": v.change_note, "is_synthetic": v.is_synthetic} for v in versions]}


@router.post("/projects/{project_id}/product", tags=["product"], status_code=201)
async def create_product_version(project_id: uuid.UUID, body: S.ProductIn, p: Principal = Depends(require_editor),
                                 s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    prev = await ctxsvc.latest_product(s, project_id)
    pv = ProductVersion(project_id=project_id, version=(prev.version + 1) if prev else 1,
                        **body.model_dump(exclude={"features"}), source="owner")
    pv.features = [ProductFeature(position=i, **f.model_dump()) for i, f in enumerate(body.features)]
    s.add(pv)
    await s.flush()
    pv.content_hash = hashing.product_hash(pv)
    # carry approved claims forward when their feature is still enabled
    if prev:
        enabled = {f.key for f in pv.features if f.enabled}
        for c in (await s.execute(select(Claim).where(Claim.product_version_id == prev.id))).scalars().all():
            if c.feature_key is None or c.feature_key in enabled:
                s.add(Claim(project_id=project_id, product_version_id=pv.id, feature_key=c.feature_key, text=c.text,
                            support_status=c.support_status, approved=c.approved, evidence_ids=c.evidence_ids,
                            approval_version=c.approval_version))
    await s.commit()
    after = ctxsvc.product_dict(pv)
    rev = None
    if prev and prev.content_hash != pv.content_hash:
        rev = await revisions.product_changed(project_id, p.user_id, ctxsvc.product_dict(prev), after)
    await events.audit(p.workspace_id, "product.version", user_id=p.user_id, project_id=project_id, target_id=str(pv.id))
    return {"product": after, "revision": rev}


class ExtractIn(BaseModel):
    text: str | None = Field(default=None, max_length=30000)
    asset_id: uuid.UUID | None = None


class _ExtractFeature(BaseModel):
    key: str
    name: str
    mechanism: str = ""
    proposed_benefit: str = ""
    operating_conditions: str = ""
    critical_unknowns: list[str] = Field(default_factory=list)


class _Extract(BaseModel):
    name: str
    description: str
    category: str
    price: float | None = None
    currency: str | None = None
    intended_benefits: list[str] = Field(default_factory=list)
    operating_limitations: list[str] = Field(default_factory=list)
    features: list[_ExtractFeature] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)


@router.post("/projects/{project_id}/product/extract", tags=["product"])
async def extract_product(project_id: uuid.UUID, body: ExtractIn, p: Principal = Depends(require_editor),
                          s: AsyncSession = Depends(get_session)):
    """Propose structured facts from a brief or uploaded document. Nothing is
    saved: the owner reviews and corrects, then saves a product version."""
    await check_project(s, p, project_id)
    text = body.text or ""
    if body.asset_id:
        pa = (await s.execute(select(ProductAsset).where(ProductAsset.project_id == project_id,
                                                         ProductAsset.asset_id == body.asset_id))).scalar_one_or_none()
        if pa is None:
            raise AppError(404, "not_found", "Document not found in this project.")
        text = (pa.extracted_text or "") + "\n" + text
    if len(text.strip()) < 20:
        raise AppError(422, "too_short", "Provide a product brief of at least a few sentences.")
    try:
        r, model = await llm.structured(
            _Extract, "Extract product facts exactly as stated. Never invent specifications, prices or capabilities. "
                      "Feature keys are short snake_case ids. List anything ambiguous or missing as open_questions, and "
                      "for each feature list critical_unknowns (e.g. whether speech uses a microphone or text-to-speech).",
            f"<data>\n{text[:20000]}\n</data>", max_tokens=2500, temperature=0)
    except ProviderError as e:
        raise AppError(503, "reasoning_unavailable", f"Extraction is unavailable: {e.message}", retryable=e.retryable) from None
    return {"proposal": r.model_dump(), "model": model, "note": "Review and correct before saving."}


@router.get("/projects/{project_id}/claims", tags=["product"])
async def list_claims(project_id: uuid.UUID, p: Principal = Depends(current_principal), s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    pv = await ctxsvc.latest_product(s, project_id)
    rows = (await s.execute(select(Claim).where(Claim.product_version_id == (pv.id if pv else None)))).scalars().all() if pv else []
    return {"items": [{"id": str(c.id), "text": c.text, "feature_key": c.feature_key, "support_status": c.support_status,
                       "approved": c.approved, "evidence_ids": c.evidence_ids} for c in rows]}


@router.post("/projects/{project_id}/claims", tags=["product"], status_code=201)
async def add_claim(project_id: uuid.UUID, body: S.ClaimIn, p: Principal = Depends(require_editor),
                    s: AsyncSession = Depends(get_session)):
    from ..services import claims as claimcheck
    await check_project(s, p, project_id)
    pv = await ctxsvc.latest_product(s, project_id)
    if pv is None:
        raise AppError(409, "no_product", "Save the product brief first.")
    issues = claimcheck.check(body.text, approved_claims=[], enabled_features=[], disabled_features=[])
    if body.approved and body.support_status in ("unsupported", "prohibited"):
        raise AppError(422, "unsupported_claim", "An unsupported or prohibited claim cannot be approved.")
    c = Claim(project_id=project_id, product_version_id=pv.id, **body.model_dump())
    s.add(c)
    await s.commit()
    return {"id": str(c.id), "warnings": issues,
            "note": "Measurements, certifications and clinical wording in an approved claim must be backed by evidence you hold."}


@router.patch("/claims/{claim_id}", tags=["product"])
async def patch_claim(claim_id: uuid.UUID, body: S.ClaimPatch, p: Principal = Depends(require_editor),
                      s: AsyncSession = Depends(get_session)):
    c = await owned(s, p, Claim, claim_id)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(c, k, v)
    if c.approved and c.support_status in ("unsupported", "prohibited"):
        raise AppError(422, "unsupported_claim", "An unsupported or prohibited claim cannot be approved.")
    c.approval_version += 1
    await s.commit()
    return {"ok": True}


# ---------------------------------------------------------------- uploads ----
SIGNATURES = [(b"\x89PNG\r\n\x1a\n", "image/png"), (b"\xff\xd8\xff", "image/jpeg"), (b"%PDF-", "application/pdf"),
              (b"ID3", "audio/mpeg"), (b"\xff\xfb", "audio/mpeg"), (b"\xff\xf3", "audio/mpeg")]


def sniff(data: bytes) -> str | None:
    for sig, mime in SIGNATURES:
        if data.startswith(sig):
            return mime
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "audio/wav"
    try:
        data[:20000].decode("utf-8")
        return "text/plain" if b"\x00" not in data[:20000] else None
    except UnicodeDecodeError:
        return None


ROLE_TYPES = {"product_photo": ("image/png", "image/jpeg", "image/webp"), "logo": ("image/png", "image/jpeg", "image/webp"),
              "document": ("application/pdf", "text/plain"), "audio": ("audio/mpeg", "audio/wav")}


@router.post("/projects/{project_id}/uploads", tags=["uploads"], status_code=201)
async def upload(project_id: uuid.UUID, role: str = Form(...), file: UploadFile = File(...),
                 usage_rights: str = Form("Owner-supplied; owner warrants the right to use it in advertising"),
                 is_primary: bool = Form(False), p: Principal = Depends(require_editor), s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    if role not in ROLE_TYPES:
        raise AppError(422, "invalid_role", "role must be product_photo, logo, document or audio.")
    limit = settings.MAX_UPLOAD_MB * 1024 * 1024
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise AppError(413, "too_large", f"Files are limited to {settings.MAX_UPLOAD_MB} MB.")
    mime = sniff(data)
    if mime not in ROLE_TYPES[role]:
        raise AppError(415, "unsupported_type", f"{role} accepts {', '.join(ROLE_TYPES[role])}; this file looks like {mime or 'unknown'}.")
    width = height = None
    extracted = ""
    if mime.startswith("image/"):
        Image.MAX_IMAGE_PIXELS = 60_000_000
        try:
            with Image.open(io.BytesIO(data)) as im:
                im.verify()
            with Image.open(io.BytesIO(data)) as im:
                width, height = im.size
        except Exception:  # noqa: BLE001
            raise AppError(415, "corrupt_image", "The image could not be read.") from None
        if max(width, height) > 8000 or min(width, height) < 200:
            raise AppError(422, "bad_dimensions", "Images must be between 200 and 8000 pixels on each side.")
    elif mime == "application/pdf":
        from pypdf import PdfReader  # text only; no scripts or forms are executed
        try:
            reader = PdfReader(io.BytesIO(data))
            extracted = "\n".join((pg.extract_text() or "") for pg in reader.pages[:30])[:60000]
        except Exception:  # noqa: BLE001
            raise AppError(415, "corrupt_pdf", "The PDF could not be read.") from None
    elif mime == "text/plain":
        extracted = data.decode("utf-8", errors="replace")[:60000]
    a = await assetsvc.save(workspace_id=p.workspace_id, project_id=project_id, kind=role, data=data, mime=mime,
                            source="upload", is_original=True, label=f"Original {role.replace('_', ' ')}",
                            original_filename=(file.filename or "")[:200], width=width, height=height,
                            metadata={"usage_rights": usage_rights})
    if is_primary and role == "product_photo":
        for other in (await s.execute(select(ProductAsset).where(ProductAsset.project_id == project_id,
                                                                 ProductAsset.role == "product_photo"))).scalars().all():
            other.is_primary = False
    has_photo = (await s.execute(select(func.count()).select_from(ProductAsset).where(
        ProductAsset.project_id == project_id, ProductAsset.role == "product_photo"))).scalar_one()
    s.add(ProductAsset(project_id=project_id, asset_id=a.id, role=role, usage_rights=usage_rights,
                       is_primary=is_primary or (role == "product_photo" and has_photo == 0), extracted_text=extracted))
    await s.commit()
    return {"asset": asset_out(a), "extracted_chars": len(extracted)}


# ---------------------------------------------------------------- audiences --
@router.get("/projects/{project_id}/audiences", tags=["audiences"])
async def list_audiences(project_id: uuid.UUID, p: Principal = Depends(current_principal), s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    avs = await ctxsvc.latest_audiences(s, project_id)
    ents = (await s.execute(select(ResolvedEntity).where(ResolvedEntity.project_id == project_id))).scalars().all()
    out = []
    for av in avs:
        d = ctxsvc.audience_dict(av)
        d["entities"] = [_entity_out(e) for e in ents if e.audience_version_id == av.id]
        hist = (await s.execute(select(AudienceVersion.version, AudienceVersion.id).where(
            AudienceVersion.audience_id == av.audience_id).order_by(AudienceVersion.version.desc()))).all()
        d["history"] = [{"version": v, "id": str(i)} for v, i in hist]
        out.append(d)
    return {"items": out}


def _entity_out(e: ResolvedEntity) -> dict:
    return {"id": str(e.id), "query_text": e.query_text, "status": e.status, "qloo_id": e.qloo_id, "qloo_type": e.qloo_type,
            "canonical_name": e.canonical_name, "candidates": e.candidates, "proxy_for": e.proxy_for,
            "proxy_reason": e.proxy_reason, "tags": e.tags,
            "audience_version_id": str(e.audience_version_id) if e.audience_version_id else None}


@router.post("/projects/{project_id}/audiences", tags=["audiences"], status_code=201)
async def create_audience(project_id: uuid.UUID, body: S.AudienceIn, p: Principal = Depends(require_editor),
                          s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    a = Audience(project_id=project_id, key=body.key or body.name.lower().replace(" ", "_")[:80])
    s.add(a)
    await s.flush()
    av = AudienceVersion(audience_id=a.id, project_id=project_id, version=1,
                         **body.model_dump(exclude={"key", "voluntary_interests"}),
                         voluntary_interests=[i.model_dump() for i in body.voluntary_interests])
    s.add(av)
    await s.flush()
    av.content_hash = hashing.audience_hash(av)
    await s.commit()
    return ctxsvc.audience_dict(av)


@router.put("/audiences/{audience_id}", tags=["audiences"])
async def update_audience(audience_id: uuid.UUID, body: S.AudienceIn, p: Principal = Depends(require_editor),
                          s: AsyncSession = Depends(get_session)):
    a = await owned(s, p, Audience, audience_id)
    prev = (await s.execute(select(AudienceVersion).where(AudienceVersion.audience_id == a.id)
                            .order_by(AudienceVersion.version.desc()).limit(1))).scalar_one()
    av = AudienceVersion(audience_id=a.id, project_id=a.project_id, version=prev.version + 1,
                         **body.model_dump(exclude={"key", "voluntary_interests"}),
                         voluntary_interests=[i.model_dump() for i in body.voluntary_interests])
    s.add(av)
    await s.flush()
    av.content_hash = hashing.audience_hash(av)
    # carry decided entity resolutions for unchanged interests
    for e in (await s.execute(select(ResolvedEntity).where(ResolvedEntity.audience_version_id == prev.id))).scalars().all():
        if any(i.text.lower() == e.query_text.lower() for i in body.voluntary_interests):
            s.add(ResolvedEntity(project_id=a.project_id, audience_version_id=av.id, query_text=e.query_text, status=e.status,
                                 qloo_id=e.qloo_id, qloo_type=e.qloo_type, canonical_name=e.canonical_name, tags=e.tags,
                                 candidates=e.candidates, proxy_for=e.proxy_for, proxy_reason=e.proxy_reason))
    await s.commit()
    rev = None
    if prev.content_hash != av.content_hash:
        rev = await revisions.audience_changed(a.project_id, p.user_id, ctxsvc.audience_dict(prev), ctxsvc.audience_dict(av))
    return {"audience": ctxsvc.audience_dict(av), "revision": rev}


@router.delete("/audiences/{audience_id}", tags=["audiences"])
async def archive_audience(audience_id: uuid.UUID, p: Principal = Depends(require_editor), s: AsyncSession = Depends(get_session)):
    a = await owned(s, p, Audience, audience_id)
    a.archived = True
    await s.commit()
    return {"archived": True}


# ---------------------------------------------------------------- entities ---
@router.get("/qloo/search", tags=["entities"])
async def qloo_search(q: str, types: str | None = None, p: Principal = Depends(current_principal)):
    if not qloo.configured():
        raise AppError(503, "qloo_unavailable", "Qloo is not configured (QLOO_API_KEY missing).")
    try:
        res, _ = await qloo.search(q[:200], [t for t in (types or "").split(",") if t], take=10)
        tags, _ = await qloo.tags(q[:200], take=5)
    except ProviderError as e:
        raise AppError(502, "qloo_error", e.message, retryable=e.retryable) from None
    return {"entities": res, "tags": tags}


@router.post("/entities/{entity_id}/resolve", tags=["entities"])
async def resolve_entity(entity_id: uuid.UUID, body: S.EntityResolveIn, p: Principal = Depends(require_editor),
                         s: AsyncSession = Depends(get_session)):
    e = await owned(s, p, ResolvedEntity, entity_id)
    if body.mark_not_found:
        e.status, e.qloo_id = "not_found", None
    elif body.qloo_id:
        cand = next((c for c in e.candidates if c.get("qloo_id") == body.qloo_id), None)
        if cand is None:
            raise AppError(422, "not_a_candidate", "Choose one of the returned candidates, or record an explicit proxy.")
        e.status, e.qloo_id, e.qloo_type, e.canonical_name = "resolved", cand["qloo_id"], cand.get("type"), cand.get("name")
        e.tags = cand.get("tags") or []
    elif body.proxy:
        px = body.proxy
        if not px.get("qloo_id") or not px.get("reason"):
            raise AppError(422, "proxy_incomplete", "A proxy needs the Qloo id you chose and a stated reason.")
        e.status, e.qloo_id, e.qloo_type = "proxy", str(px["qloo_id"])[:120], str(px.get("type", ""))[:80]
        e.canonical_name, e.proxy_for, e.proxy_reason = str(px.get("name", ""))[:300], e.query_text, str(px["reason"])[:500]
    else:
        raise AppError(422, "nothing_chosen", "Choose a candidate, a proxy, or mark not found.")
    e.decided_by = p.user_id
    await s.commit()
    return _entity_out(e)


# ---------------------------------------------------------------- constraints
@router.get("/projects/{project_id}/constraints", tags=["constraints"])
async def get_constraints(project_id: uuid.UUID, p: Principal = Depends(current_principal), s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    cv = await ctxsvc.latest_constraints(s, project_id)
    hist = (await s.execute(select(ConstraintVersion.version, ConstraintVersion.created_at, ConstraintVersion.change_note)
                            .where(ConstraintVersion.project_id == project_id).order_by(ConstraintVersion.version.desc()))).all()
    from ..services.scoring import COMPONENT_LABELS, DEFAULT_WEIGHTS
    return {"current": ctxsvc.constraint_dict(cv) if cv else None, "default_weights": DEFAULT_WEIGHTS,
            "weight_labels": COMPONENT_LABELS,
            "history": [{"version": v, "created_at": c.isoformat(), "change_note": n} for v, c, n in hist]}


@router.put("/projects/{project_id}/constraints", tags=["constraints"])
async def put_constraints(project_id: uuid.UUID, body: S.ConstraintsIn, p: Principal = Depends(require_editor),
                          s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    prev = await ctxsvc.latest_constraints(s, project_id)
    data = body.model_dump(mode="json")
    cv = ConstraintVersion(project_id=project_id, version=(prev.version + 1) if prev else 1,
                           country_code=body.country_code.upper(), candidate_regions=data["candidate_regions"],
                           service_regions=data["service_regions"], excluded_regions=data["excluded_regions"],
                           production_budget=body.production_budget, ad_spend_budget=body.ad_spend_budget,
                           currency=body.currency.upper(), min_ad_spend_per_location=body.min_ad_spend_per_location,
                           distribution_requirements=data["distribution_requirements"], weights=body.weights,
                           change_note=body.change_note)
    s.add(cv)
    await s.flush()
    cv.content_hash = hashing.constraint_hash(cv)
    await s.commit()
    rev = await revisions.constraints_changed(project_id, p.user_id, ctxsvc.constraint_dict(prev) if prev else None,
                                              ctxsvc.constraint_dict(cv))
    return {"constraints": ctxsvc.constraint_dict(cv), "revision": rev}


# ---------------------------------------------------------------- geo --------
@router.get("/geo/search", tags=["geo"])
async def geo_search(q: str, country: str = "", p: Principal = Depends(current_principal)):
    if len(q.strip()) < 2:
        raise AppError(422, "too_short", "Type at least two characters.")
    import re
    m = re.fullmatch(r"\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*", q)
    if m:
        lat, lon = float(m.group(1)), float(m.group(2))
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise AppError(422, "bad_coordinates", "Coordinates are out of range.")
        return {"results": [{"label": f"{lat:.5f}, {lon:.5f}", "lat": lat, "lon": lon, "type": "coordinate",
                             "source": "user coordinate (EPSG:4326)", "country_code": country.upper()}],
                "disambiguation_needed": False}
    try:
        res, meta = await geo.geocode(q[:200], country, limit=6)
    except ProviderError as e:
        raise AppError(502, "geocoding_unavailable", e.message, retryable=e.retryable) from None
    return {"results": res, "disambiguation_needed": len(res) > 1, "source": meta.get("source"),
            "attribution": "© OpenStreetMap contributors"}


@router.get("/projects/{project_id}/areas", tags=["geo"])
async def list_areas(project_id: uuid.UUID, p: Principal = Depends(current_principal), s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    rows = (await s.execute(select(GeographicArea).where(GeographicArea.project_id == project_id)
                            .order_by(GeographicArea.created_at))).scalars().all()
    return {"items": [_area_out(a) for a in rows]}


def _area_out(a: GeographicArea) -> dict:
    shape = to_shape(a.geom)
    ring = list(shape.exterior.coords) if shape.geom_type == "Polygon" else []
    return {"id": str(a.id), "name": a.name, "kind": a.kind, "country_code": a.country_code, "center": point(a.center),
            "radius_m": num(a.radius_m), "crs": a.crs, "source": a.source, "display_name": a.display_name,
            "polygon": [[round(x, 6), round(y, 6)] for x, y in ring], "shortlisted_place_ids": a.shortlisted_place_ids,
            "created_at": a.created_at.isoformat()}


@router.post("/projects/{project_id}/areas", tags=["geo"], status_code=201)
async def save_area(project_id: uuid.UUID, body: S.AreaIn, p: Principal = Depends(require_editor),
                    s: AsyncSession = Depends(get_session)):
    await check_project(s, p, project_id)
    from ..services.research import _circle
    if body.polygon:
        if len(body.polygon) < 3:
            raise AppError(422, "bad_polygon", "A polygon needs at least three points.")
        poly = Polygon(body.polygon)
        if not poly.is_valid or poly.area <= 0:
            raise AppError(422, "bad_polygon", "The polygon is not valid.")
        center, radius = poly.centroid, None
    elif body.lat is not None and body.lon is not None and body.radius_km:
        poly, center, radius = _circle(body.lat, body.lon, body.radius_km * 1000), Point(body.lon, body.lat), body.radius_km * 1000
    else:
        raise AppError(422, "no_geometry", "Give a polygon or a centre with radius.")
    a = GeographicArea(project_id=project_id, name=body.name, kind="saved", center=from_shape(center, srid=4326),
                       geom=from_shape(poly, srid=4326), radius_m=Decimal(str(radius)) if radius else None,
                       source="user-drawn" if body.polygon else "user radius", shortlisted_place_ids=body.shortlisted_place_ids)
    s.add(a)
    await s.commit()
    return _area_out(a)


@router.patch("/areas/{area_id}", tags=["geo"])
async def patch_area(area_id: uuid.UUID, body: dict, p: Principal = Depends(require_editor), s: AsyncSession = Depends(get_session)):
    a = await owned(s, p, GeographicArea, area_id)
    if "shortlisted_place_ids" in body:
        a.shortlisted_place_ids = [str(x) for x in body["shortlisted_place_ids"]][:200]
    if "name" in body:
        a.name = str(body["name"])[:200]
    await s.commit()
    return _area_out(a)


@router.get("/workspace/members", tags=["auth"])
async def members(p: Principal = Depends(current_principal), s: AsyncSession = Depends(get_session)):
    rows = (await s.execute(select(User.username, Membership.role).join(Membership, Membership.user_id == User.id)
                            .where(Membership.workspace_id == p.workspace_id))).all()
    return {"items": [{"username": u, "role": r} for u, r in rows]}


_ = Workspace
