"""Content hashes that drive selective invalidation.

Each downstream artefact records the hash of exactly the inputs it depends
on. A change is propagated only where a hash actually changes:
  product facts      -> strategies, briefs, media
  constraints        -> location assessments (research), strategies
  audience version   -> that audience's strategies, briefs, media
  brief copy         -> composed images/videos (re-render, no new generation)
  brief visuals      -> backgrounds and clips (regeneration)
A caption edit changes only copy_hash, so research is never re-run for it.
"""
from __future__ import annotations

from .cache import stable_hash


def product_hash(pv) -> str:
    feats = [{"key": f.key, "name": f.name, "mechanism": f.mechanism, "benefit": f.proposed_benefit,
              "conditions": f.operating_conditions, "status": f.evidence_status, "enabled": f.enabled}
             for f in sorted(pv.features, key=lambda f: f.position)]
    return stable_hash({"name": pv.name, "desc": pv.description, "cat": pv.category, "price": str(pv.price),
                        "cur": pv.currency, "benefits": pv.intended_benefits, "limits": pv.operating_limitations,
                        "features": feats, "dist": pv.distribution_options})


def audience_hash(av) -> str:
    return stable_hash({"name": av.name, "role": av.role, "desc": av.description, "needs": av.needs,
                        "interests": av.voluntary_interests, "langs": av.languages})


def constraint_hash(cv) -> str:
    return stable_hash({"country": cv.country_code, "cand": cv.candidate_regions, "svc": cv.service_regions,
                        "excl": cv.excluded_regions, "prod_budget": str(cv.production_budget),
                        "ad_budget": str(cv.ad_spend_budget), "min_loc": str(cv.min_ad_spend_per_location),
                        "dist": cv.distribution_requirements, "weights": cv.weights})


def research_hash(constraint_h: str, audience_hashes: list[str], qloo_enabled: bool, entity_ids: list[str]) -> str:
    return stable_hash({"c": constraint_h, "a": sorted(audience_hashes), "q": qloo_enabled, "e": sorted(entity_ids)})


def strategy_hash(product_h: str, audience_h: str, assessment_h: str, placement_ids: list[str]) -> str:
    return stable_hash({"p": product_h, "a": audience_h, "loc": assessment_h, "pl": sorted(placement_ids)})


COPY_FIELDS = ("headline", "body", "cta", "price_text", "disclaimer", "language")
VISUAL_FIELDS = ("setting", "visual_direction", "product_treatment", "mood")


def copy_hash(content: dict) -> str:
    return stable_hash({k: content.get(k) for k in COPY_FIELDS})


def visual_hash(content: dict) -> str:
    return stable_hash({k: content.get(k) for k in VISUAL_FIELDS})


def identity_hash(product_version_id, area_id, audience_version_id, language, channel, objective, angle) -> str:
    return stable_hash([str(product_version_id), str(area_id), str(audience_version_id), language, channel,
                        objective, angle])
