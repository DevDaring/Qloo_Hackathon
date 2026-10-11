"""Validated request models (and the main response shapes) for /api/v1."""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator

Lang = Literal["en", "hi", "bn", "es"]
# feature-emphasis angles: legacy names for the original sample, lead_<feature_key> for any product
ANGLE_PATTERN = r"^(fan_comfort|speech_presence|institutional_brief|distributor_intro|lead_[a-z0-9_]{1,60})$"
Role = Literal["product_user", "purchaser", "institutional_buyer", "distribution_partner"]
Preset = Literal["square", "portrait", "vertical"]
Orientation = Literal["vertical", "landscape"]


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=200)


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    goal: str = Field(default="", max_length=2000)
    country_code: str = Field(default="IN", min_length=2, max_length=2)
    currency: str = Field(default="INR", min_length=3, max_length=3)


class ProjectPatch(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    goal: str | None = Field(default=None, max_length=2000)
    archived: bool | None = None
    status: str | None = Field(default=None, max_length=40)


class FeatureIn(BaseModel):
    key: str = Field(pattern=r"^[a-z0-9_]{1,80}$")
    name: str = Field(min_length=1, max_length=200)
    mechanism: str = Field(default="", max_length=2000)
    proposed_benefit: str = Field(default="", max_length=2000)
    operating_conditions: str = Field(default="", max_length=2000)
    evidence_status: Literal["verified", "owner_stated", "unverified", "unknown"] = "owner_stated"
    source: str = Field(default="owner", max_length=200)
    prohibited_exaggerations: list[str] = Field(default_factory=list, max_length=30)
    critical_unknowns: list[str] = Field(default_factory=list, max_length=20)
    enabled: bool = True


class ProductIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)
    category: str = Field(default="", max_length=120)
    price: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)
    currency: str = Field(default="INR", min_length=3, max_length=3)
    intended_benefits: list[str] = Field(default_factory=list, max_length=30)
    operating_limitations: list[str] = Field(default_factory=list, max_length=30)
    launch_date: date | None = None
    distribution_options: list[str] = Field(default_factory=list, max_length=20)
    available_stock: int | None = Field(default=None, ge=0)
    brand_colours: list[str] = Field(default_factory=list, max_length=8)
    brand_voice: str = Field(default="", max_length=1000)
    website: str = Field(default="", max_length=500)
    cta_destination: str = Field(default="", max_length=500)
    features: list[FeatureIn] = Field(default_factory=list, max_length=20)
    change_note: str = Field(default="", max_length=500)

    @field_validator("brand_colours")
    @classmethod
    def _hex(cls, v: list[str]) -> list[str]:
        import re
        for c in v:
            if not re.fullmatch(r"#[0-9A-Fa-f]{6}", c):
                raise ValueError(f"{c} is not a #RRGGBB colour")
        return v


class ClaimIn(BaseModel):
    text: str = Field(min_length=3, max_length=500)
    feature_key: str | None = Field(default=None, max_length=80)
    support_status: Literal["verified", "owner_stated", "unsupported", "prohibited"] = "owner_stated"
    approved: bool = False
    evidence_ids: list[str] = Field(default_factory=list)


class ClaimPatch(BaseModel):
    text: str | None = Field(default=None, max_length=500)
    support_status: Literal["verified", "owner_stated", "unsupported", "prohibited"] | None = None
    approved: bool | None = None


class Interest(BaseModel):
    text: str = Field(min_length=1, max_length=200)
    type: str | None = Field(default=None, max_length=60)


class AudienceIn(BaseModel):
    key: str | None = Field(default=None, max_length=80)
    name: str = Field(min_length=1, max_length=200)
    role: Role
    description: str = Field(default="", max_length=2000)
    needs: list[str] = Field(default_factory=list, max_length=20)
    voluntary_interests: list[Interest] = Field(default_factory=list, max_length=15)
    languages: list[Lang] = Field(default_factory=lambda: ["en"])
    research_notes: str = Field(default="", max_length=4000)


class Region(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    query: str | None = Field(default=None, max_length=200)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    radius_km: float = Field(default=5, gt=0, le=200)
    label: str | None = Field(default=None, max_length=400)
    country_code: str | None = Field(default=None, max_length=2)
    source: str | None = Field(default=None, max_length=200)


class ConstraintsIn(BaseModel):
    country_code: str = Field(default="IN", min_length=2, max_length=2)
    candidate_regions: list[Region] = Field(default_factory=list, max_length=8)
    service_regions: list[Region] = Field(default_factory=list, max_length=20)
    excluded_regions: list[Region] = Field(default_factory=list, max_length=20)
    production_budget: Decimal | None = Field(default=None, ge=0)
    ad_spend_budget: Decimal | None = Field(default=None, ge=0)
    currency: str = Field(default="INR", min_length=3, max_length=3)
    min_ad_spend_per_location: Decimal | None = Field(default=None, ge=0)
    distribution_requirements: list[Literal["partner_outlet_in_area"]] = Field(default_factory=list)
    weights: dict[str, float] = Field(default_factory=dict)
    change_note: str = Field(default="", max_length=500)

    @field_validator("weights")
    @classmethod
    def _weights(cls, v: dict[str, float]) -> dict[str, float]:
        from ..services.scoring import DEFAULT_WEIGHTS
        for k, w in v.items():
            if k not in DEFAULT_WEIGHTS or not (0 <= w <= 1):
                raise ValueError(f"invalid weight {k}={w}")
        return v


class AreaIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    radius_km: float | None = Field(default=None, gt=0, le=200)
    polygon: list[list[float]] | None = Field(default=None, description="[[lon, lat], ...] ring in EPSG:4326")
    shortlisted_place_ids: list[str] = Field(default_factory=list)


class RunIn(BaseModel):
    qloo_enabled: bool = True
    label: str = Field(default="", max_length=60)
    idempotency_key: str | None = Field(default=None, max_length=120)


class ResumeIn(BaseModel):
    decision: dict


class CompareIn(BaseModel):
    run_id: uuid.UUID
    area_ids: list[uuid.UUID] = Field(min_length=1, max_length=8)


class PlacementPatch(BaseModel):
    shortlisted: bool | None = None
    status: Literal["candidate", "availability_unknown", "verified_opportunity", "rejected"] | None = None
    verification: dict[str, Literal["verified", "unknown", "declined"]] | None = None
    owner_notes: str | None = Field(default=None, max_length=2000)
    accessibility: Literal["unknown", "verified_step_free", "verified_not_step_free"] | None = None


class StrategyIn(BaseModel):
    run_id: uuid.UUID
    area_id: uuid.UUID
    audience_version_id: uuid.UUID
    force: bool = False


class BriefIn(BaseModel):
    strategy_version_id: uuid.UUID
    language: Lang = "en"
    channel: Literal["social", "print", "stories"] = "social"
    objective: str = Field(default="inquiries", max_length=60)
    angle: str | None = Field(default=None, pattern=ANGLE_PATTERN)


class BriefPatch(BaseModel):
    lock_version: int
    headline: str | None = Field(default=None, max_length=90)
    body: str | None = Field(default=None, max_length=260)
    cta: str | None = Field(default=None, max_length=40)
    disclaimer: str | None = Field(default=None, max_length=160)
    price_text: str | None = Field(default=None, max_length=40)
    setting: str | None = Field(default=None, max_length=400)
    visual_direction: str | None = Field(default=None, max_length=600)
    background_prompt: str | None = Field(default=None, max_length=1200)
    mood: str | None = Field(default=None, max_length=200)


class DuplicateIn(BaseModel):
    strategy_version_id: uuid.UUID
    language: Lang | None = None
    angle: str | None = Field(default=None, pattern=ANGLE_PATTERN)


class Focus(BaseModel):
    x: float = Field(0.5, ge=0, le=1)
    y: float = Field(0.5, ge=0, le=1)


class ImagesIn(BaseModel):
    presets: list[Preset] = Field(default_factory=lambda: ["square"], min_length=1, max_length=3)
    crop_focus: dict[Preset, Focus] = Field(default_factory=dict, description="Per-preset background focal point")
    cap_usd: Decimal = Field(default=Decimal("0.50"), gt=0, le=20)
    regenerate_background: bool = False
    idempotency_key: str | None = Field(default=None, max_length=120)


class VideosIn(BaseModel):
    orientations: list[Orientation] = Field(default_factory=lambda: ["vertical"], min_length=1, max_length=2)
    mode: Literal["full", "animatic"] = "full"
    cap_usd: Decimal = Field(default=Decimal("2.00"), gt=0, le=30)
    narration: bool = False
    only_scene: int | None = Field(default=None, ge=0, le=5)
    regenerate: bool = False
    idempotency_key: str | None = Field(default=None, max_length=120)


class ScenePatch(BaseModel):
    on_screen_text: str | None = Field(default=None, max_length=160)
    spoken_copy: str | None = Field(default=None, max_length=400)
    shot_description: str | None = Field(default=None, max_length=800)
    duration_s: int | None = Field(default=None, ge=3, le=8)
    product_overlay: bool | None = Field(default=None, description="Composite the real product photo over this scene")


class RetryIn(BaseModel):
    confirm_unknown_submissions: bool = False


class ReconcileIn(BaseModel):
    outcome: Literal["not_charged", "charged_no_output"]
    note: str = Field(default="", max_length=500)


class ApprovalIn(BaseModel):
    state: Literal["approved", "needs_review", "rejected", "draft"]


class ResultRow(BaseModel):
    period_start: date
    period_end: date
    area_name: str = Field(default="", max_length=200)
    channel: str = Field(default="", max_length=80)
    strategy_version_id: uuid.UUID | None = None
    brief_id: uuid.UUID | None = None
    placement_id: uuid.UUID | None = None
    impressions: int | None = Field(default=None, ge=0)
    clicks: int | None = Field(default=None, ge=0)
    inquiries: int | None = Field(default=None, ge=0)
    leads: int | None = Field(default=None, ge=0)
    purchases: int | None = Field(default=None, ge=0)
    spend: Decimal | None = Field(default=None, ge=0)
    currency: str = Field(default="INR", min_length=3, max_length=3)
    measurement_source: str = Field(min_length=2, max_length=500)
    notes: str = Field(default="", max_length=2000)


class ResultsIn(BaseModel):
    rows: list[ResultRow] = Field(min_length=1, max_length=500)


class ConsultIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    run_id: uuid.UUID | None = None


class RevisionApplyIn(BaseModel):
    kind: Literal["exclude_region", "set_ad_budget", "disable_feature", "enable_feature", "change_audience_role"]
    region_name: str | None = None
    ad_spend_budget: Decimal | None = Field(default=None, ge=0)
    feature_key: str | None = None
    audience_id: uuid.UUID | None = None
    role: Role | None = None
    rerun: bool = True


class EntityResolveIn(BaseModel):
    qloo_id: str | None = Field(default=None, max_length=120)
    proxy: dict | None = Field(default=None, description="{qloo_id, name, type, reason} for an explicit proxy")
    mark_not_found: bool = False


class ExperimentIn(BaseModel):
    run_id: uuid.UUID


class RatingIn(BaseModel):
    ratings: dict[str, int] = Field(description="area_id -> owner relevance rating 1-5")
