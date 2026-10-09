"""Relational model. Business entities are tables; JSONB holds only versioned,
provider-shaped or layout payloads. Money is NUMERIC, never float. Geography is
PostGIS (SRID 4326, WGS 84) with explicit GiST indexes.

Evidence is shared across versions: deleting a strategy or brief version does
not cascade into evidence records (ON DELETE SET NULL / RESTRICT where noted).
"""
from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from geoalchemy2 import Geography, Geometry
from sqlalchemy import false as sa_false
from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index, Integer,
    Numeric, String, Text, UniqueConstraint, func, text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

MONEY = Numeric(14, 6)


def uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                         server_default=text("gen_random_uuid()"))


def ts_created() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


def ts_updated() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


def fk(target: str, ondelete: str = "CASCADE", nullable: bool = False, index: bool = True):
    return mapped_column(UUID(as_uuid=True), ForeignKey(target, ondelete=ondelete), nullable=nullable, index=index)


# ---------------------------------------------------------------- tenancy ----
class Workspace(Base):
    __tablename__ = "workspaces"
    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(200))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    daily_cost_cap_usd: Mapped[Decimal] = mapped_column(MONEY, default=Decimal("10"))
    created_at: Mapped[datetime] = ts_created()


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = uuid_pk()
    username: Mapped[str] = mapped_column(String(120), unique=True)
    display_name: Mapped[str] = mapped_column(String(200), default="")
    password_hash: Mapped[str] = mapped_column(String(200))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = ts_created()
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("workspace_id", "user_id"),
                      CheckConstraint("role in ('owner','editor','viewer')", name="ck_membership_role"))
    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = fk("workspaces.id")
    user_id: Mapped[uuid.UUID] = fk("users.id")
    role: Mapped[str] = mapped_column(String(20), default="editor")


# ---------------------------------------------------------------- projects ---
class Project(Base):
    __tablename__ = "projects"
    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = fk("workspaces.id")
    owner_id: Mapped[uuid.UUID | None] = fk("users.id", ondelete="SET NULL", nullable=True)
    name: Mapped[str] = mapped_column(String(200))
    goal: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(40), default="draft")
    country_code: Mapped[str] = mapped_column(String(2), default="IN")
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    locked: Mapped[bool] = mapped_column(Boolean, default=False, server_default=sa_false())  # read-only shared sample
    saved_map_state: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = ts_created()
    updated_at: Mapped[datetime] = ts_updated()


class ProductVersion(Base):
    __tablename__ = "product_versions"
    __table_args__ = (UniqueConstraint("project_id", "version"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = fk("projects.id")
    version: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(120), default="")
    price: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    intended_benefits: Mapped[list] = mapped_column(JSONB, default=list)
    operating_limitations: Mapped[list] = mapped_column(JSONB, default=list)
    launch_date: Mapped[datetime | None] = mapped_column(Date)
    distribution_options: Mapped[list] = mapped_column(JSONB, default=list)
    available_stock: Mapped[int | None] = mapped_column(Integer)
    brand_colours: Mapped[list] = mapped_column(JSONB, default=list)
    brand_voice: Mapped[str] = mapped_column(Text, default="")
    website: Mapped[str] = mapped_column(String(500), default="")
    cta_destination: Mapped[str] = mapped_column(String(500), default="")
    open_questions: Mapped[list] = mapped_column(JSONB, default=list)
    source: Mapped[str] = mapped_column(String(40), default="owner")  # owner | extracted | synthetic_fixture
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    content_hash: Mapped[str] = mapped_column(String(64), default="")
    change_note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = ts_created()
    features: Mapped[list["ProductFeature"]] = relationship(
        back_populates="product_version", cascade="all, delete-orphan", order_by="ProductFeature.position", lazy="selectin")


class ProductFeature(Base):
    __tablename__ = "product_features"
    id: Mapped[uuid.UUID] = uuid_pk()
    product_version_id: Mapped[uuid.UUID] = fk("product_versions.id")
    position: Mapped[int] = mapped_column(Integer, default=0)
    key: Mapped[str] = mapped_column(String(80))
    name: Mapped[str] = mapped_column(String(200))
    mechanism: Mapped[str] = mapped_column(Text, default="")
    proposed_benefit: Mapped[str] = mapped_column(Text, default="")
    operating_conditions: Mapped[str] = mapped_column(Text, default="")
    evidence_status: Mapped[str] = mapped_column(String(30), default="unverified")  # verified|owner_stated|unverified|unknown
    source: Mapped[str] = mapped_column(String(200), default="owner")
    prohibited_exaggerations: Mapped[list] = mapped_column(JSONB, default=list)
    critical_unknowns: Mapped[list] = mapped_column(JSONB, default=list)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    product_version: Mapped[ProductVersion] = relationship(back_populates="features")


class ProductAsset(Base):
    """Links an immutable uploaded original to a project with usage rights."""
    __tablename__ = "product_assets"
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = fk("projects.id")
    asset_id: Mapped[uuid.UUID] = fk("assets.id", ondelete="RESTRICT")
    role: Mapped[str] = mapped_column(String(30))  # product_photo | logo | document | audio
    usage_rights: Mapped[str] = mapped_column(Text, default="owner-supplied; owner warrants rights")
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    extracted_text: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = ts_created()


class Claim(Base):
    __tablename__ = "claims"
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = fk("projects.id")
    product_version_id: Mapped[uuid.UUID] = fk("product_versions.id")
    feature_key: Mapped[str | None] = mapped_column(String(80))
    text: Mapped[str] = mapped_column(Text)
    support_status: Mapped[str] = mapped_column(String(30), default="owner_stated")  # verified|owner_stated|unsupported|prohibited
    approved: Mapped[bool] = mapped_column(Boolean, default=False)
    evidence_ids: Mapped[list] = mapped_column(JSONB, default=list)
    approval_version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = ts_created()


class Audience(Base):
    __tablename__ = "audiences"
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = fk("projects.id")
    key: Mapped[str] = mapped_column(String(80))
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = ts_created()


class AudienceVersion(Base):
    __tablename__ = "audience_versions"
    __table_args__ = (UniqueConstraint("audience_id", "version"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    audience_id: Mapped[uuid.UUID] = fk("audiences.id")
    project_id: Mapped[uuid.UUID] = fk("projects.id")
    version: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(40))  # product_user|purchaser|institutional_buyer|distribution_partner
    description: Mapped[str] = mapped_column(Text, default="")
    needs: Mapped[list] = mapped_column(JSONB, default=list)
    voluntary_interests: Mapped[list] = mapped_column(JSONB, default=list)
    languages: Mapped[list] = mapped_column(JSONB, default=list)
    research_notes: Mapped[str] = mapped_column(Text, default="")
    is_hypothetical_persona: Mapped[bool] = mapped_column(Boolean, default=True)
    content_hash: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = ts_created()


class ConstraintVersion(Base):
    """Launch constraints: budgets, candidate regions, service coverage."""
    __tablename__ = "constraint_versions"
    __table_args__ = (UniqueConstraint("project_id", "version"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = fk("projects.id")
    version: Mapped[int] = mapped_column(Integer)
    country_code: Mapped[str] = mapped_column(String(2), default="IN")
    candidate_regions: Mapped[list] = mapped_column(JSONB, default=list)  # [{name, query, lat, lon, radius_km}]
    service_regions: Mapped[list] = mapped_column(JSONB, default=list)    # [{name, lat, lon, radius_km}]
    excluded_regions: Mapped[list] = mapped_column(JSONB, default=list)
    production_budget: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    ad_spend_budget: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    min_ad_spend_per_location: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    distribution_requirements: Mapped[list] = mapped_column(JSONB, default=list)
    weights: Mapped[dict] = mapped_column(JSONB, default=dict)
    content_hash: Mapped[str] = mapped_column(String(64), default="")
    change_note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = ts_created()


# ---------------------------------------------------------------- geography --
class GeographicArea(Base):
    __tablename__ = "geographic_areas"
    __table_args__ = (Index("ix_geographic_areas_geom", "geom", postgresql_using="gist"),
                      Index("ix_geographic_areas_center", "center", postgresql_using="gist"))
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = fk("projects.id")
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(20), default="candidate")  # candidate | saved | service
    country_code: Mapped[str] = mapped_column(String(2), default="")
    center: Mapped[object] = mapped_column(Geography("POINT", srid=4326, spatial_index=False))
    geom: Mapped[object] = mapped_column(Geography("GEOMETRY", srid=4326, spatial_index=False))  # buffered circle or user polygon
    radius_m: Mapped[float | None] = mapped_column(Numeric(12, 2))
    crs: Mapped[str] = mapped_column(String(20), default="EPSG:4326")
    source: Mapped[str] = mapped_column(String(200), default="")
    source_ref: Mapped[dict] = mapped_column(JSONB, default=dict)
    display_name: Mapped[str] = mapped_column(Text, default="")
    shortlisted_place_ids: Mapped[list] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = ts_created()


class Place(Base):
    """A retrieved place, snapshotted per research run so that map, list,
    counts and charts read the same bounded dataset."""
    __tablename__ = "places"
    __table_args__ = (UniqueConstraint("run_id", "provider", "provider_id"),
                      Index("ix_places_geom", "geom", postgresql_using="gist"))
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = fk("projects.id")
    run_id: Mapped[uuid.UUID] = fk("research_runs.id")
    area_id: Mapped[uuid.UUID] = fk("geographic_areas.id")
    provider: Mapped[str] = mapped_column(String(40))  # qloo | osm-overpass | upload | synthetic_fixture
    provider_id: Mapped[str] = mapped_column(String(200))
    name: Mapped[str] = mapped_column(String(300))
    category: Mapped[str] = mapped_column(String(80))       # app category
    role: Mapped[str] = mapped_column(String(30), default="other")  # competitor | partner | venue | institution | other
    role_basis: Mapped[str] = mapped_column(String(30), default="inferred_category")  # confirmed | inferred_category
    provider_categories: Mapped[list] = mapped_column(JSONB, default=list)
    address: Mapped[str] = mapped_column(Text, default="")
    geom: Mapped[object] = mapped_column(Geography("POINT", srid=4326, spatial_index=False))
    distance_m: Mapped[float | None] = mapped_column(Numeric(12, 2))
    accessibility: Mapped[str] = mapped_column(String(30), default="unknown")
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    qloo_entity_id: Mapped[str | None] = mapped_column(String(80))
    retrieved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    evidence_id: Mapped[uuid.UUID | None] = fk("evidence_records.id", ondelete="SET NULL", nullable=True)


class ResolvedEntity(Base):
    __tablename__ = "resolved_entities"
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = fk("projects.id")
    audience_version_id: Mapped[uuid.UUID | None] = fk("audience_versions.id", ondelete="SET NULL", nullable=True)
    query_text: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(30), default="pending")  # pending|ambiguous|resolved|proxy|not_found|unavailable
    qloo_id: Mapped[str | None] = mapped_column(String(120))
    qloo_type: Mapped[str | None] = mapped_column(String(80))
    canonical_name: Mapped[str | None] = mapped_column(String(300))
    tags: Mapped[list] = mapped_column(JSONB, default=list)
    candidates: Mapped[list] = mapped_column(JSONB, default=list)
    proxy_for: Mapped[str | None] = mapped_column(String(300))  # what this proxy stands in for
    proxy_reason: Mapped[str] = mapped_column(Text, default="")
    decided_by: Mapped[uuid.UUID | None] = fk("users.id", ondelete="SET NULL", nullable=True, index=False)
    created_at: Mapped[datetime] = ts_created()
    updated_at: Mapped[datetime] = ts_updated()


# ---------------------------------------------------------------- research ---
class ResearchRun(Base):
    __tablename__ = "research_runs"
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = fk("projects.id")
    workspace_id: Mapped[uuid.UUID] = fk("workspaces.id")
    thread_id: Mapped[str] = mapped_column(String(120), unique=True)
    status: Mapped[str] = mapped_column(String(40), default="queued")
    stage: Mapped[str] = mapped_column(String(60), default="")
    qloo_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    experiment_label: Mapped[str] = mapped_column(String(60), default="")
    input_snapshot: Mapped[dict] = mapped_column(JSONB, default=dict)
    input_hash: Mapped[str] = mapped_column(String(64), default="")
    product_version_id: Mapped[uuid.UUID | None] = fk("product_versions.id", ondelete="SET NULL", nullable=True)
    constraint_version_id: Mapped[uuid.UUID | None] = fk("constraint_versions.id", ondelete="SET NULL", nullable=True)
    previous_run_id: Mapped[uuid.UUID | None] = fk("research_runs.id", ondelete="SET NULL", nullable=True, index=False)
    pending_decision: Mapped[dict | None] = mapped_column(JSONB)
    selections: Mapped[dict] = mapped_column(JSONB, default=dict)
    stage_statuses: Mapped[dict] = mapped_column(JSONB, default=dict)
    counts: Mapped[dict] = mapped_column(JSONB, default=dict)
    errors: Mapped[list] = mapped_column(JSONB, default=list)
    cost_usd: Mapped[Decimal] = mapped_column(MONEY, default=Decimal("0"))
    started_by: Mapped[uuid.UUID | None] = fk("users.id", ondelete="SET NULL", nullable=True, index=False)
    created_at: Mapped[datetime] = ts_created()
    updated_at: Mapped[datetime] = ts_updated()


class EvidenceRecord(Base):
    __tablename__ = "evidence_records"
    __table_args__ = (CheckConstraint(
        "kind in ('observed_fact','owner_fact','provider_signal','derived_metric','hypothesis','synthetic_fixture','data_gap')",
        name="ck_evidence_kind"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = fk("projects.id")
    run_id: Mapped[uuid.UUID | None] = fk("research_runs.id", ondelete="SET NULL", nullable=True)
    area_id: Mapped[uuid.UUID | None] = fk("geographic_areas.id", ondelete="SET NULL", nullable=True)
    audience_version_id: Mapped[uuid.UUID | None] = fk("audience_versions.id", ondelete="SET NULL", nullable=True)
    kind: Mapped[str] = mapped_column(String(30))
    status: Mapped[str] = mapped_column(String(30), default="supported")  # supported|hypothesis|unknown|stale|demo|needs_review
    topic: Mapped[str] = mapped_column(String(80))  # climate|places|taste|service|budget|competition|feature|...
    title: Mapped[str] = mapped_column(String(300))
    statement: Mapped[str] = mapped_column(Text)
    value_numeric: Mapped[Decimal | None] = mapped_column(Numeric(20, 6))
    units: Mapped[str] = mapped_column(String(60), default="")
    source: Mapped[str] = mapped_column(String(120))
    source_ref: Mapped[str] = mapped_column(Text, default="")
    retrieved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    period: Mapped[str] = mapped_column(String(120), default="")
    scope: Mapped[dict] = mapped_column(JSONB, default=dict)
    formula: Mapped[str] = mapped_column(Text, default="")
    input_evidence_ids: Mapped[list] = mapped_column(JSONB, default=list)
    limitations: Mapped[str] = mapped_column(Text, default="")
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    redistributable: Mapped[bool] = mapped_column(Boolean, default=True)
    input_hash: Mapped[str] = mapped_column(String(64), default="", index=True)
    created_at: Mapped[datetime] = ts_created()


class LocationAssessment(Base):
    __tablename__ = "location_assessments"
    __table_args__ = (UniqueConstraint("run_id", "area_id"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = fk("projects.id")
    run_id: Mapped[uuid.UUID] = fk("research_runs.id")
    area_id: Mapped[uuid.UUID] = fk("geographic_areas.id")
    eligible: Mapped[bool] = mapped_column(Boolean)
    status: Mapped[str] = mapped_column(String(30))  # complete | incomplete | excluded
    hard_constraints: Mapped[list] = mapped_column(JSONB, default=list)
    components: Mapped[dict] = mapped_column(JSONB, default=dict)
    weights: Mapped[dict] = mapped_column(JSONB, default=dict)
    practical_index: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))
    cultural_index: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))
    planning_index: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))
    available_weight: Mapped[Decimal] = mapped_column(Numeric(8, 4), default=Decimal("0"))
    evidence_coverage: Mapped[Decimal] = mapped_column(Numeric(8, 4), default=Decimal("0"))
    rank: Mapped[int | None] = mapped_column(Integer)
    assumptions: Mapped[list] = mapped_column(JSONB, default=list)
    limitations: Mapped[list] = mapped_column(JSONB, default=list)
    evidence_ids: Mapped[list] = mapped_column(JSONB, default=list)
    input_hash: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = ts_created()


class PlacementCandidate(Base):
    __tablename__ = "placement_candidates"
    __table_args__ = (CheckConstraint(
        "status in ('candidate','availability_unknown','verified_opportunity','rejected')", name="ck_placement_status"),
        Index("ix_placement_candidates_geom", "geom", postgresql_using="gist"))
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = fk("projects.id")
    run_id: Mapped[uuid.UUID] = fk("research_runs.id")
    area_id: Mapped[uuid.UUID] = fk("geographic_areas.id")
    place_id: Mapped[uuid.UUID | None] = fk("places.id", ondelete="SET NULL", nullable=True)
    audience_version_id: Mapped[uuid.UUID | None] = fk("audience_versions.id", ondelete="SET NULL", nullable=True)
    channel_type: Mapped[str] = mapped_column(String(40))  # physical_venue|partner_business|retail_distributor|community_event|digital_geo|publication
    name: Mapped[str] = mapped_column(String(300))
    category: Mapped[str] = mapped_column(String(80), default="")
    address: Mapped[str] = mapped_column(Text, default="")
    geom: Mapped[object | None] = mapped_column(Geography("POINT", srid=4326, spatial_index=False), nullable=True)
    source: Mapped[str] = mapped_column(String(120), default="")
    relationship_note: Mapped[str] = mapped_column(Text, default="")
    qloo_relevance: Mapped[dict] = mapped_column(JSONB, default=dict)
    practical_evidence_ids: Mapped[list] = mapped_column(JSONB, default=list)
    activation: Mapped[str] = mapped_column(String(40), default="partnership_flyer")
    accessibility: Mapped[str] = mapped_column(String(30), default="unknown")
    verification: Mapped[dict] = mapped_column(JSONB, default=dict)  # availability/permission/contact/cost/dates -> verified|unknown
    status: Mapped[str] = mapped_column(String(30), default="availability_unknown")
    shortlisted: Mapped[bool] = mapped_column(Boolean, default=False)
    next_action: Mapped[str] = mapped_column(Text, default="")
    evidence_needed: Mapped[str] = mapped_column(Text, default="")
    suitability_score: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))
    owner_notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = ts_created()
    updated_at: Mapped[datetime] = ts_updated()


# ---------------------------------------------------------------- strategy ---
class StrategyVersion(Base):
    __tablename__ = "strategy_versions"
    __table_args__ = (UniqueConstraint("project_id", "area_id", "audience_version_id", "version"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = fk("projects.id")
    run_id: Mapped[uuid.UUID | None] = fk("research_runs.id", ondelete="SET NULL", nullable=True)
    area_id: Mapped[uuid.UUID] = fk("geographic_areas.id")
    audience_version_id: Mapped[uuid.UUID] = fk("audience_versions.id")
    product_version_id: Mapped[uuid.UUID] = fk("product_versions.id")
    version: Mapped[int] = mapped_column(Integer)
    content: Mapped[dict] = mapped_column(JSONB)
    budget_scenario: Mapped[dict] = mapped_column(JSONB, default=dict)
    evidence_ids: Mapped[list] = mapped_column(JSONB, default=list)
    generator: Mapped[dict] = mapped_column(JSONB, default=dict)
    validation: Mapped[dict] = mapped_column(JSONB, default=dict)
    input_hash: Mapped[str] = mapped_column(String(64), default="")
    stale: Mapped[bool] = mapped_column(Boolean, default=False)
    stale_reason: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = ts_created()


class CreativeBrief(Base):
    __tablename__ = "creative_briefs"
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = fk("projects.id")
    strategy_version_id: Mapped[uuid.UUID] = fk("strategy_versions.id")
    lineage_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), index=True)  # all versions of one brief share it
    version: Mapped[int] = mapped_column(Integer, default=1)
    # campaign identity
    product_version_id: Mapped[uuid.UUID] = fk("product_versions.id")
    area_id: Mapped[uuid.UUID] = fk("geographic_areas.id")
    audience_version_id: Mapped[uuid.UUID] = fk("audience_versions.id")
    language: Mapped[str] = mapped_column(String(8), default="en")
    channel: Mapped[str] = mapped_column(String(40), default="social")
    objective: Mapped[str] = mapped_column(String(60), default="awareness")
    angle: Mapped[str] = mapped_column(String(80), default="")
    identity_hash: Mapped[str] = mapped_column(String(64), index=True)
    content: Mapped[dict] = mapped_column(JSONB)
    decisions: Mapped[list] = mapped_column(JSONB, default=list)  # [{decision, evidence_ids, kind}]
    approval_state: Mapped[str] = mapped_column(String(30), default="draft")
    translation_status: Mapped[str] = mapped_column(String(40), default="source")
    lock_version: Mapped[int] = mapped_column(Integer, default=1)
    copy_hash: Mapped[str] = mapped_column(String(64), default="")
    visual_hash: Mapped[str] = mapped_column(String(64), default="")
    stale: Mapped[bool] = mapped_column(Boolean, default=False)
    stale_reason: Mapped[str] = mapped_column(Text, default="")
    is_current: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = ts_created()
    updated_at: Mapped[datetime] = ts_updated()


class Storyboard(Base):
    __tablename__ = "storyboards"
    id: Mapped[uuid.UUID] = uuid_pk()
    brief_id: Mapped[uuid.UUID] = fk("creative_briefs.id")
    version: Mapped[int] = mapped_column(Integer, default=1)
    total_seconds: Mapped[Decimal] = mapped_column(Numeric(6, 2))
    aspect_ratio: Mapped[str] = mapped_column(String(10), default="9:16")
    audio_plan: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = ts_created()
    scenes: Mapped[list["StoryboardScene"]] = relationship(
        cascade="all, delete-orphan", order_by="StoryboardScene.idx", lazy="selectin")


class StoryboardScene(Base):
    __tablename__ = "storyboard_scenes"
    id: Mapped[uuid.UUID] = uuid_pk()
    storyboard_id: Mapped[uuid.UUID] = fk("storyboards.id")
    idx: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(20), default="generated")  # generated | end_card
    purpose: Mapped[str] = mapped_column(Text, default="")
    shot_description: Mapped[str] = mapped_column(Text, default="")
    duration_s: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    product_reference_asset_id: Mapped[uuid.UUID | None] = fk("assets.id", ondelete="SET NULL", nullable=True, index=False)
    spoken_copy: Mapped[str] = mapped_column(Text, default="")
    on_screen_text: Mapped[str] = mapped_column(Text, default="")
    claim_ids: Mapped[list] = mapped_column(JSONB, default=list)
    clip_asset_id: Mapped[uuid.UUID | None] = fk("assets.id", ondelete="SET NULL", nullable=True, index=False)
    status: Mapped[str] = mapped_column(String(30), default="planned")
    input_hash: Mapped[str] = mapped_column(String(64), default="")


# ---------------------------------------------------------------- jobs -------
JOB_STATUSES = ("queued", "running", "waiting_for_provider", "waiting_for_user", "completed",
                "partially_completed", "failed", "cancellation_requested", "cancelled")


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (
        UniqueConstraint("workspace_id", "idempotency_key"),
        CheckConstraint("status in ('" + "','".join(JOB_STATUSES) + "')", name="ck_job_status"),
        Index("ix_jobs_claim", "status", "available_at"),
    )
    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = fk("workspaces.id")
    project_id: Mapped[uuid.UUID | None] = fk("projects.id", nullable=True)
    run_id: Mapped[uuid.UUID | None] = fk("research_runs.id", ondelete="SET NULL", nullable=True)
    parent_job_id: Mapped[uuid.UUID | None] = fk("jobs.id", ondelete="SET NULL", nullable=True, index=False)
    kind: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(30), default="queued")
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    result: Mapped[dict] = mapped_column(JSONB, default=dict)
    error: Mapped[dict | None] = mapped_column(JSONB)
    idempotency_key: Mapped[str] = mapped_column(String(200))
    input_hash: Mapped[str] = mapped_column(String(64), default="")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    lease_owner: Mapped[str | None] = mapped_column(String(120))
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    deadline_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cost_cap_usd: Mapped[Decimal | None] = mapped_column(MONEY)
    progress: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_by: Mapped[uuid.UUID | None] = fk("users.id", ondelete="SET NULL", nullable=True, index=False)
    created_at: Mapped[datetime] = ts_created()
    updated_at: Mapped[datetime] = ts_updated()
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ProviderAttempt(Base):
    """The paid-call ledger. A row is written (and committed) BEFORE a paid
    submission, so a crash between submit and response leaves evidence."""
    __tablename__ = "provider_attempts"
    __table_args__ = (UniqueConstraint("idempotency_key"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    job_id: Mapped[uuid.UUID | None] = fk("jobs.id", ondelete="SET NULL", nullable=True)
    workspace_id: Mapped[uuid.UUID] = fk("workspaces.id")
    project_id: Mapped[uuid.UUID | None] = fk("projects.id", nullable=True)
    provider: Mapped[str] = mapped_column(String(40))
    operation: Mapped[str] = mapped_column(String(60))
    model: Mapped[str] = mapped_column(String(120), default="")
    idempotency_key: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(30), default="prepared")
    # prepared | submitted | succeeded | failed | submission_unknown | reconciled | cancelled
    remote_request_id: Mapped[str | None] = mapped_column(String(200), index=True)
    request_summary: Mapped[dict] = mapped_column(JSONB, default=dict)
    response_summary: Mapped[dict] = mapped_column(JSONB, default=dict)
    error: Mapped[dict | None] = mapped_column(JSONB)
    cost_reserved_usd: Mapped[Decimal] = mapped_column(MONEY, default=Decimal("0"))
    cost_actual_usd: Mapped[Decimal | None] = mapped_column(MONEY)
    output_asset_ids: Mapped[list] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = ts_created()
    updated_at: Mapped[datetime] = ts_updated()


# ---------------------------------------------------------------- assets -----
class Asset(Base):
    __tablename__ = "assets"
    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = fk("workspaces.id")
    project_id: Mapped[uuid.UUID | None] = fk("projects.id", nullable=True)
    kind: Mapped[str] = mapped_column(String(40))
    storage_key: Mapped[str] = mapped_column(String(500), unique=True)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    mime_type: Mapped[str] = mapped_column(String(100))
    bytes: Mapped[int] = mapped_column(BigInteger)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    duration_s: Mapped[Decimal | None] = mapped_column(Numeric(8, 3))
    original_filename: Mapped[str] = mapped_column(String(300), default="")
    is_original: Mapped[bool] = mapped_column(Boolean, default=False)
    source: Mapped[str] = mapped_column(String(40))  # upload|xai|composed|ffmpeg|tts|synthetic_fixture|fallback_slideshow
    label: Mapped[str] = mapped_column(String(200), default="")
    provider_model: Mapped[str] = mapped_column(String(120), default="")
    remote_request_id: Mapped[str | None] = mapped_column(String(200))
    brief_id: Mapped[uuid.UUID | None] = fk("creative_briefs.id", ondelete="SET NULL", nullable=True)
    identity_hash: Mapped[str] = mapped_column(String(64), default="", index=True)
    preset: Mapped[str] = mapped_column(String(30), default="")
    group_key: Mapped[str] = mapped_column(String(200), default="", index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    supersedes_id: Mapped[uuid.UUID | None] = fk("assets.id", ondelete="SET NULL", nullable=True, index=False)
    input_hash: Mapped[str] = mapped_column(String(64), default="")
    lineage: Mapped[dict] = mapped_column(JSONB, default=dict)
    layout: Mapped[dict] = mapped_column(JSONB, default=dict)
    quality: Mapped[dict] = mapped_column(JSONB, default=dict)
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    approval_state: Mapped[str] = mapped_column(String(30), default="draft")  # draft|needs_review|approved|rejected
    stale: Mapped[bool] = mapped_column(Boolean, default=False)
    stale_reason: Mapped[str] = mapped_column(Text, default="")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = ts_created()


class UsageLedger(Base):
    __tablename__ = "usage_ledger"
    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = fk("workspaces.id")
    project_id: Mapped[uuid.UUID | None] = fk("projects.id", nullable=True)
    job_id: Mapped[uuid.UUID | None] = fk("jobs.id", ondelete="SET NULL", nullable=True)
    attempt_id: Mapped[uuid.UUID | None] = fk("provider_attempts.id", ondelete="SET NULL", nullable=True)
    run_id: Mapped[uuid.UUID | None] = fk("research_runs.id", ondelete="SET NULL", nullable=True)
    provider: Mapped[str] = mapped_column(String(40))
    model: Mapped[str] = mapped_column(String(120), default="")
    operation: Mapped[str] = mapped_column(String(60))
    category: Mapped[str] = mapped_column(String(20))  # research | reasoning | image | video | audio
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 4), default=Decimal("0"))
    unit: Mapped[str] = mapped_column(String(30), default="")
    estimated_usd: Mapped[Decimal] = mapped_column(MONEY, default=Decimal("0"))
    actual_usd: Mapped[Decimal | None] = mapped_column(MONEY)
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    pricing_source: Mapped[str] = mapped_column(Text, default="")
    state: Mapped[str] = mapped_column(String(20), default="reserved")  # reserved | committed | released
    created_at: Mapped[datetime] = ts_created()
    updated_at: Mapped[datetime] = ts_updated()


class CampaignResult(Base):
    __tablename__ = "campaign_results"
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = fk("projects.id")
    strategy_version_id: Mapped[uuid.UUID | None] = fk("strategy_versions.id", ondelete="SET NULL", nullable=True)
    brief_id: Mapped[uuid.UUID | None] = fk("creative_briefs.id", ondelete="SET NULL", nullable=True)
    placement_id: Mapped[uuid.UUID | None] = fk("placement_candidates.id", ondelete="SET NULL", nullable=True)
    area_name: Mapped[str] = mapped_column(String(200), default="")
    channel: Mapped[str] = mapped_column(String(80), default="")
    period_start: Mapped[datetime] = mapped_column(Date)
    period_end: Mapped[datetime] = mapped_column(Date)
    impressions: Mapped[int | None] = mapped_column(BigInteger)
    clicks: Mapped[int | None] = mapped_column(BigInteger)
    inquiries: Mapped[int | None] = mapped_column(BigInteger)
    leads: Mapped[int | None] = mapped_column(BigInteger)
    purchases: Mapped[int | None] = mapped_column(BigInteger)
    spend: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    measurement_source: Mapped[str] = mapped_column(Text)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = ts_created()


class Export(Base):
    __tablename__ = "exports"
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = fk("projects.id")
    job_id: Mapped[uuid.UUID | None] = fk("jobs.id", ondelete="SET NULL", nullable=True)
    asset_id: Mapped[uuid.UUID | None] = fk("assets.id", ondelete="SET NULL", nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="queued")
    manifest: Mapped[dict] = mapped_column(JSONB, default=dict)
    included_versions: Mapped[dict] = mapped_column(JSONB, default=dict)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = ts_created()


class RunEvent(Base):
    __tablename__ = "run_events"
    __table_args__ = (Index("ix_run_events_stream", "project_id", "id"),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    workspace_id: Mapped[uuid.UUID] = fk("workspaces.id")
    project_id: Mapped[uuid.UUID | None] = fk("projects.id", nullable=True, index=False)
    run_id: Mapped[uuid.UUID | None] = fk("research_runs.id", ondelete="CASCADE", nullable=True)
    job_id: Mapped[uuid.UUID | None] = fk("jobs.id", ondelete="CASCADE", nullable=True)
    type: Mapped[str] = mapped_column(String(40))
    stage: Mapped[str] = mapped_column(String(60), default="")
    message: Mapped[str] = mapped_column(Text, default="")
    data: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = ts_created()


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[uuid.UUID] = uuid_pk()
    workspace_id: Mapped[uuid.UUID] = fk("workspaces.id")
    user_id: Mapped[uuid.UUID | None] = fk("users.id", ondelete="SET NULL", nullable=True)
    project_id: Mapped[uuid.UUID | None] = fk("projects.id", nullable=True)
    action: Mapped[str] = mapped_column(String(80))
    target_type: Mapped[str] = mapped_column(String(60), default="")
    target_id: Mapped[str] = mapped_column(String(80), default="")
    details: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = ts_created()


class ProviderCache(Base):
    __tablename__ = "provider_cache"
    __table_args__ = (UniqueConstraint("provider", "query_hash"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    provider: Mapped[str] = mapped_column(String(40))
    endpoint: Mapped[str] = mapped_column(String(200))
    query_hash: Mapped[str] = mapped_column(String(64))
    query: Mapped[dict] = mapped_column(JSONB, default=dict)  # sanitized params, never credentials
    provider_version: Mapped[str] = mapped_column(String(60), default="")
    response: Mapped[dict] = mapped_column(JSONB)
    status_code: Mapped[int] = mapped_column(Integer, default=200)
    redistributable: Mapped[bool] = mapped_column(Boolean, default=False)
    retrieved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class Revision(Base):
    __tablename__ = "revisions"
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = fk("projects.id")
    user_id: Mapped[uuid.UUID | None] = fk("users.id", ondelete="SET NULL", nullable=True, index=False)
    kind: Mapped[str] = mapped_column(String(40))  # constraint|product|audience|copy|budget
    summary: Mapped[str] = mapped_column(Text)
    before: Mapped[dict] = mapped_column(JSONB, default=dict)
    after: Mapped[dict] = mapped_column(JSONB, default=dict)
    invalidated: Mapped[dict] = mapped_column(JSONB, default=dict)
    preserved: Mapped[dict] = mapped_column(JSONB, default=dict)
    run_id: Mapped[uuid.UUID | None] = fk("research_runs.id", ondelete="SET NULL", nullable=True)
    created_at: Mapped[datetime] = ts_created()


class ConsultMessage(Base):
    __tablename__ = "consult_messages"
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = fk("projects.id")
    user_id: Mapped[uuid.UUID | None] = fk("users.id", ondelete="SET NULL", nullable=True, index=False)
    role: Mapped[str] = mapped_column(String(20))  # user | assistant
    content: Mapped[str] = mapped_column(Text)
    evidence_ids: Mapped[list] = mapped_column(JSONB, default=list)
    proposed_revision: Mapped[dict | None] = mapped_column(JSONB)
    model: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = ts_created()


class Experiment(Base):
    """With/without-Qloo comparison holding practical evidence constant."""
    __tablename__ = "experiments"
    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = fk("projects.id")
    run_with_qloo_id: Mapped[uuid.UUID] = fk("research_runs.id")
    run_without_qloo_id: Mapped[uuid.UUID] = fk("research_runs.id")
    conditions: Mapped[dict] = mapped_column(JSONB, default=dict)
    metrics: Mapped[dict] = mapped_column(JSONB, default=dict)
    owner_ratings: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = ts_created()


_ = (Geometry, ARRAY)  # re-exported types used by migrations
