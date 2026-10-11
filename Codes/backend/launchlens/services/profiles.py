"""Product category profiles: everything about research and creative that
depends on WHAT is being launched — which places matter (OpenStreetMap and
Qloo place categories), how well each place type fits an audience role, the
activation and next action per place type, which climate signal makes a
feature more relevant, and what generated imagery must never depict.

The profile is chosen from the product's category text. "mobility" is the
original power-wheelchair profile; "audio" covers portable speakers.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Climate:
    metric: str                 # key in geo.climate_summary()
    title: str                  # "{area}: {value} ..." headline for the observed fact
    units: str
    feature_key: str            # the feature this climate signal may make more relevant
    hyp_title: str
    hyp_statement: str


@dataclass(frozen=True)
class Profile:
    key: str
    osm: list[tuple[str, str, str, str]]           # (Overpass selector, app category, role, role_basis)
    qloo_tags: dict[str, tuple[str, str]]          # Qloo place-category tag -> (app category, role)
    role_fit: dict[str, dict[str, float]]
    activation: dict[str, tuple[str, str]]         # category -> (channel_type, activation)
    next_action: dict[str, str]
    climate: Climate
    avoid: str                                     # what generated imagery must not show
    risky_words: str                               # regex alternation for prompt clauses to drop
    distributor_note: str = ""
    extra: dict = field(default_factory=dict)


MOBILITY = Profile(
    key="mobility",
    osm=[
        ('nwr["shop"="medical_supply"]', "medical_supply_store", "competitor", "inferred_category"),
        ('nwr["shop"="mobility_scooter"]', "mobility_store", "competitor", "inferred_category"),
        ('nwr["amenity"="pharmacy"]', "pharmacy", "partner", "inferred_category"),
        ('nwr["healthcare"="physiotherapist"]', "physiotherapy", "partner", "inferred_category"),
        ('nwr["amenity"="hospital"]', "hospital", "institution", "inferred_category"),
        ('nwr["amenity"="clinic"]', "clinic", "institution", "inferred_category"),
        ('nwr["amenity"="social_facility"]', "social_facility", "institution", "inferred_category"),
        ('nwr["amenity"="community_centre"]', "community_centre", "venue", "inferred_category"),
        ('nwr["shop"="mall"]', "shopping_mall", "venue", "inferred_category"),
        ('nwr["shop"="electronics"]', "electronics_store", "partner", "inferred_category"),
    ],
    qloo_tags={
        "urn:tag:category:place:pharmacy": ("pharmacy", "partner"),
        "urn:tag:category:place:hospital": ("hospital", "institution"),
        "urn:tag:category:place:medical_clinic": ("clinic", "institution"),
        "urn:tag:category:place:shopping_mall": ("shopping_mall", "venue"),
        "urn:tag:category:place:community_center": ("community_centre", "venue"),
        "urn:tag:category:place:senior_citizen_center": ("social_facility", "institution"),
        "urn:tag:category:place:nursing_home": ("social_facility", "institution"),
        "urn:tag:category:place:physical_therapist": ("physiotherapy", "partner"),
        "urn:tag:category:place:medical_supply_store": ("medical_supply_store", "competitor"),
        "urn:tag:category:place:mobility_equipment_supplier": ("mobility_store", "competitor"),
        "urn:tag:category:place:electronics_store": ("electronics_store", "partner"),
    },
    role_fit={
        "product_user": {"community_centre": 1.0, "shopping_mall": 0.9, "physiotherapy": 0.9, "pharmacy": 0.7,
                         "social_facility": 0.6, "medical_supply_store": 0.6, "hospital": 0.4, "clinic": 0.4},
        "purchaser": {"pharmacy": 1.0, "shopping_mall": 0.9, "community_centre": 0.8, "medical_supply_store": 0.8,
                      "physiotherapy": 0.7, "electronics_store": 0.5, "hospital": 0.4, "clinic": 0.4},
        "institutional_buyer": {"hospital": 1.0, "clinic": 0.9, "social_facility": 1.0, "physiotherapy": 0.7},
        "distribution_partner": {"medical_supply_store": 1.0, "mobility_store": 1.0, "pharmacy": 0.8,
                                 "electronics_store": 0.6},
    },
    activation={
        "community_centre": ("physical_venue", "demonstration"), "shopping_mall": ("physical_venue", "demonstration"),
        "physiotherapy": ("partner_business", "partnership_flyer"), "pharmacy": ("partner_business", "counter_display"),
        "medical_supply_store": ("retail_distributor", "counter_display"),
        "mobility_store": ("retail_distributor", "counter_display"),
        "electronics_store": ("retail_distributor", "counter_display"), "hospital": ("partner_business", "demonstration"),
        "clinic": ("partner_business", "partnership_flyer"), "social_facility": ("partner_business", "demonstration"),
    },
    next_action={
        "physical_venue": "Contact the venue manager to ask whether product demonstrations are permitted, on which dates, and at what cost.",
        "partner_business": "Visit or call to ask whether they accept partner flyers or a demo session; confirm decision-maker and terms.",
        "retail_distributor": "Ask whether they stock mobility products from new brands and on what margin/terms.",
        "digital_geo": "Confirm the ad platform's geo-targeting options and minimum spend for this area before committing budget.",
    },
    climate=Climate(
        metric="hot_days_per_year_tmax_ge_35c", title="{area}: {value} days/yr with max ≥ 35 °C", units="days/year",
        feature_key="fan", hyp_title="Fan feature may be relevant in {area}'s hot season",
        hyp_statement=("Frequent hot days suggest the built-in fan could be a relevant message here. This is a "
                       "feature-relevance hypothesis to test, not proof of comfort benefit, medical effectiveness or "
                       "buyer demand.")),
    avoid="the product, a wheelchair, a mobility device, a fan, a microphone",
    risky_words=r"wheel ?chair|mobility|scooter|walker|crutch|medical|device|product|fan\b|microphone|speaker",
)

AUDIO = Profile(
    key="audio",
    osm=[
        ('nwr["shop"="electronics"]', "electronics_store", "partner", "inferred_category"),
        ('nwr["shop"="hifi"]', "hifi_store", "competitor", "inferred_category"),
        ('nwr["shop"="music"]', "record_store", "partner", "inferred_category"),
        ('nwr["shop"="musical_instrument"]', "music_instrument_store", "partner", "inferred_category"),
        ('nwr["amenity"="music_venue"]', "music_venue", "venue", "inferred_category"),
        ('nwr["amenity"="community_centre"]', "community_centre", "venue", "inferred_category"),
        ('nwr["shop"="mall"]', "shopping_mall", "venue", "inferred_category"),
        ('nwr["shop"="sports"]', "sporting_goods_store", "partner", "inferred_category"),
        ('nwr["amenity"="university"]', "college", "institution", "inferred_category"),
        ('nwr["amenity"="college"]', "college", "institution", "inferred_category"),
    ],
    qloo_tags={
        "urn:tag:category:place:record_store": ("record_store", "partner"),
        "urn:tag:category:place:electronics_store": ("electronics_store", "partner"),
        "urn:tag:category:place:coffee_shop": ("cafe", "venue"),
        "urn:tag:category:place:bar": ("bar", "venue"),
        "urn:tag:category:place:park": ("park", "venue"),
        "urn:tag:category:place:beach": ("beach", "venue"),
        "urn:tag:category:place:skatepark": ("skatepark", "venue"),
        "urn:tag:category:place:gym": ("gym", "partner"),
        "urn:tag:category:place:college": ("college", "institution"),
        "urn:tag:category:place:sporting_goods_store": ("sporting_goods_store", "partner"),
        "urn:tag:category:place:shopping_mall": ("shopping_mall", "venue"),
    },
    role_fit={
        "product_user": {"park": 1.0, "beach": 1.0, "skatepark": 0.9, "record_store": 0.9, "music_venue": 0.9,
                         "bar": 0.8, "college": 0.8, "cafe": 0.7, "gym": 0.6, "shopping_mall": 0.6,
                         "community_centre": 0.5},
        "purchaser": {"shopping_mall": 1.0, "electronics_store": 0.9, "sporting_goods_store": 0.8,
                      "music_instrument_store": 0.6, "record_store": 0.6, "cafe": 0.5, "community_centre": 0.5},
        "institutional_buyer": {"college": 1.0, "community_centre": 0.9, "music_venue": 0.7},
        "distribution_partner": {"electronics_store": 1.0, "hifi_store": 0.9, "record_store": 0.9,
                                 "music_instrument_store": 0.8, "sporting_goods_store": 0.7},
    },
    activation={
        "park": ("physical_venue", "pop_up_demo"), "beach": ("physical_venue", "pop_up_demo"),
        "skatepark": ("physical_venue", "pop_up_demo"), "music_venue": ("physical_venue", "sponsorship"),
        "shopping_mall": ("physical_venue", "demonstration"), "community_centre": ("physical_venue", "demonstration"),
        "record_store": ("retail_distributor", "counter_display"), "electronics_store": ("retail_distributor", "counter_display"),
        "hifi_store": ("retail_distributor", "counter_display"),
        "music_instrument_store": ("retail_distributor", "counter_display"),
        "sporting_goods_store": ("retail_distributor", "counter_display"),
        "cafe": ("partner_business", "listening_session"), "bar": ("partner_business", "listening_session"),
        "gym": ("partner_business", "partnership_flyer"), "college": ("partner_business", "campus_event"),
    },
    next_action={
        "physical_venue": ("Check the venue's or parks department's rules for amplified sound, then ask about demo "
                           "dates, permits and cost."),
        "partner_business": "Visit or call to ask whether they would host a listening session or display flyers; confirm decision-maker and terms.",
        "retail_distributor": "Ask whether they stock audio products from new brands and on what margin/terms.",
        "digital_geo": "Confirm the ad platform's geo-targeting options and minimum spend for this area before committing budget.",
    },
    climate=Climate(
        metric="outdoor_days_per_year_tmax_20_32c", title="{area}: {value} days/yr with a 20–32 °C daytime maximum",
        units="days/year", feature_key="splash_resistant",
        hyp_title="Outdoor use may be relevant in {area}",
        hyp_statement=("Many mild-to-warm days suggest outdoor listening could be a relevant message here. This is a "
                       "feature-relevance hypothesis to test, not proof of demand or durability.")),
    avoid="the product, a speaker, headphones, earbuds, a phone, any audio device",
    risky_words=r"speaker|headphone|earbud|boombox|radio|phone|audio device|device|product|gadget",
)

PROFILES = {p.key: p for p in (MOBILITY, AUDIO)}
_AUDIO_WORDS = re.compile(r"speaker|audio|sound|headphone|earbud|boombox", re.I)


def for_product(product: dict | None) -> Profile:
    text = f"{(product or {}).get('category', '')} {(product or {}).get('name', '')}"
    return AUDIO if _AUDIO_WORDS.search(text) else MOBILITY


def osm_tag_index(p: Profile) -> dict[tuple[str, str], tuple[str, str, str, str]]:
    out = {}
    for row in p.osm:
        m = re.match(r'nwr\["([a-z_:]+)"="([a-z_]+)"\]', row[0])
        if m:
            out[(m.group(1), m.group(2))] = row
    return out
