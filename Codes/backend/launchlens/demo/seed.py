"""Seed the jury/demo workspace and the labelled IoT-wheelchair sample project.

    python -m launchlens.demo.seed                 # users + sample project (idempotent)
    python -m launchlens.demo.seed --product-image # also create the synthetic placeholder
                                                   # product photo with xAI (one paid image)

Everything about the sample product is an explicit SYNTHETIC placeholder: no
certification, measured performance or field research is implied.
"""
from __future__ import annotations

import argparse
import asyncio
import io
from decimal import Decimal
from pathlib import Path

from PIL import Image, ImageDraw
from sqlalchemy import select

from ..config import settings
from ..db import session_scope
from ..models import (
    Audience, AudienceVersion, Claim, ConstraintVersion, Membership, ProductAsset, ProductFeature, ProductVersion, Project,
    User, Workspace,
)
from ..security import hash_password
from ..services import assets as assetsvc
from ..services import hashing

FIXTURES = Path(__file__).parent / "fixtures"
PRODUCT_IMG = FIXTURES / "product_placeholder.png"
DEMO_NAME = "IoT wheelchair launch — sample (synthetic)"


async def ensure_user(username: str, password: str, workspace_name: str, *, is_demo: bool, role: str = "editor",
                      cap: Decimal = Decimal("5")) -> tuple[User, Workspace]:
    async with session_scope() as s:
        user = (await s.execute(select(User).where(User.username == username))).scalar_one_or_none()
        if user is None:
            user = User(username=username, display_name=username, password_hash=hash_password(password))
            s.add(user)
            await s.flush()
        elif not __import__("bcrypt").checkpw(password.encode(), user.password_hash.encode()):
            user.password_hash = hash_password(password)
        m = (await s.execute(select(Membership).where(Membership.user_id == user.id))).scalars().first()
        if m is None:
            ws = Workspace(name=workspace_name, is_demo=is_demo, daily_cost_cap_usd=cap)
            s.add(ws)
            await s.flush()
            s.add(Membership(workspace_id=ws.id, user_id=user.id, role=role))
        else:
            ws = await s.get(Workspace, m.workspace_id)
        return user, ws


def logo_png() -> bytes:
    im = Image.new("RGBA", (640, 200), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    from ..services.compose import font
    d.rounded_rectangle([0, 20, 160, 180], 40, fill=(255, 122, 69, 255))
    d.ellipse([46, 66, 114, 134], outline=(255, 255, 255, 255), width=12)
    d.text((190, 40), "Demo", font=font("en", "ExtraBold", 64), fill=(255, 255, 255, 255))
    d.text((190, 112), "Mobility (sample)", font=font("en", "Bold", 40), fill=(255, 255, 255, 220))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


async def make_product_image() -> None:
    from ..providers import xai
    prompt = ("Studio product photograph of a modern electric power wheelchair, three-quarter view, matte graphite frame, "
              "black cushioned seat, a small round fan housing mounted on the back of the seat, a compact speaker grille on "
              "the right armrest next to the joystick, plain pure white seamless background, soft even studio lighting, "
              "the whole chair visible with margin around it, no people, no text, no logos")
    res = await xai.generate_image(prompt, aspect_ratio="1:1")
    FIXTURES.mkdir(parents=True, exist_ok=True)
    Image.open(io.BytesIO(res["bytes"])).convert("RGB").save(PRODUCT_IMG)
    print(f"placeholder product image written ({res['cost_usd']} USD)")


async def seed_project(ws: Workspace, user: User) -> Project:
    async with session_scope() as s:
        proj = (await s.execute(select(Project).where(Project.workspace_id == ws.id, Project.name == DEMO_NAME))).scalar_one_or_none()
        if proj:
            return proj
        proj = Project(workspace_id=ws.id, owner_id=user.id, name=DEMO_NAME, is_demo=True, locked=True, country_code="IN", currency="INR",
                       status="ready_for_research",
                       goal="Find where a connected power wheelchair with a fan and speech amplification may fit in India, "
                            "for whom, and produce evidence-backed pilot ads. All specifications are synthetic placeholders.")
        s.add(proj)
        await s.flush()
        pv = ProductVersion(
            project_id=proj.id, version=1, name="Breeze IoT Chair (sample)", category="power wheelchair",
            description=("A connected electric power wheelchair with a user-switchable seat-back fan and a built-in speech "
                         "amplification unit. SYNTHETIC SAMPLE: specifications are placeholders for demonstration."),
            price=Decimal("85000.00"), currency="INR",
            intended_benefits=["Moving air while seated on warm days", "Easier to be heard in busy places"],
            operating_limitations=["Fan runs only while the chair is powered", "Outdoor use in heavy rain not specified"],
            distribution_options=["direct demo + order", "mobility/medical supply retailers", "institutional procurement"],
            brand_colours=["#FF7A45", "#1F6FEB"], brand_voice="warm, respectful, practical; never pitying",
            cta_destination="https://example.com/demo", source="synthetic_fixture", is_synthetic=True,
            open_questions=["Which connected functions exist (the sample assumes none beyond basic status)?",
                            "Does speech amplification use a microphone, another speech input, or text-to-speech?"],
            change_note="Synthetic sample brief")
        pv.features = [
            ProductFeature(position=0, key="fan", name="Seat-back fan",
                           mechanism="Low-voltage fan in the seat back, powered by the chair battery, switched by the user",
                           proposed_benefit="Moving air while seated on warm days",
                           operating_conditions="Only while the chair is powered on", evidence_status="owner_stated",
                           source="synthetic sample brief",
                           prohibited_exaggerations=["prevents heatstroke", "medical cooling", "air conditioning"]),
            ProductFeature(position=1, key="speech_amplification", name="Speech amplification",
                           mechanism="Armrest speaker amplifies the user's voice (input method to be confirmed)",
                           proposed_benefit="Easier to be heard in conversations in busy places",
                           operating_conditions="Indoor and outdoor; effect in noisy places not measured",
                           evidence_status="owner_stated", source="synthetic sample brief",
                           prohibited_exaggerations=["crystal clear in any noise", "medical hearing aid"],
                           critical_unknowns=["Confirm: microphone, another speech input, or text-to-speech?"]),
        ]
        s.add(pv)
        await s.flush()
        pv.content_hash = hashing.product_hash(pv)
        for text_, fk in (("A built-in seat-back fan you can switch on while seated.", "fan"),
                          ("Built-in speech amplification.", "speech_amplification")):
            s.add(Claim(project_id=proj.id, product_version_id=pv.id, feature_key=fk, text=text_,
                        support_status="owner_stated", approved=True))
        auds = [
            ("wheelchair_users", "Everyday power-chair users (hypothetical persona)", "product_user",
             "Adults who already use a mobility device and spend time outdoors and in community spaces.",
             ["comfort on hot afternoons", "joining conversations in busy places"],
             [{"text": "Cricket"}, {"text": "Rabindra Sangeet"}, {"text": "Street food"}], ["bn", "en"]),
            ("family_buyers", "Family members buying for a relative (hypothetical persona)", "purchaser",
             "Adult children and relatives who research and pay for mobility equipment.",
             ["reliable service nearby", "practical comfort features"],
             [{"text": "Bollywood"}, {"text": "Home appliances"}], ["hi", "en"]),
            ("institutions", "Hospital and rehabilitation procurement", "institutional_buyer",
             "Procurement and therapy leads at hospitals, rehab centres and senior-care facilities.",
             ["service coverage", "demonstration before purchase"], [], ["en"]),
        ]
        for key, name, role, desc, needs, interests, langs in auds:
            a = Audience(project_id=proj.id, key=key)
            s.add(a)
            await s.flush()
            av = AudienceVersion(audience_id=a.id, project_id=proj.id, version=1, name=name, role=role, description=desc,
                                 needs=needs, voluntary_interests=interests, languages=langs, is_hypothetical_persona=True,
                                 research_notes="Interests are illustrative for the sample; no individuals were identified.")
            s.add(av)
            await s.flush()
            av.content_hash = hashing.audience_hash(av)
        cv = ConstraintVersion(
            project_id=proj.id, version=1, country_code="IN",
            candidate_regions=[
                {"name": "Kolkata", "lat": 22.5726, "lon": 88.3639, "radius_km": 5, "label": "Kolkata, West Bengal", "source": "seed (OSM coordinates)"},
                {"name": "New Delhi", "lat": 28.6139, "lon": 77.2090, "radius_km": 5, "label": "New Delhi, Delhi", "source": "seed (OSM coordinates)"},
                {"name": "Chennai", "lat": 13.0827, "lon": 80.2707, "radius_km": 5, "label": "Chennai, Tamil Nadu", "source": "seed (OSM coordinates)"}],
            service_regions=[{"name": "Kolkata metro service area", "lat": 22.5726, "lon": 88.3639, "radius_km": 60},
                             {"name": "Delhi NCR service area", "lat": 28.6139, "lon": 77.2090, "radius_km": 60}],
            excluded_regions=[], production_budget=Decimal("25000"), ad_spend_budget=Decimal("60000"), currency="INR",
            min_ad_spend_per_location=Decimal("15000"), distribution_requirements=["partner_outlet_in_area"], weights={},
            change_note="Sample constraints: service exists only around Kolkata and Delhi")
        s.add(cv)
        await s.flush()
        cv.content_hash = hashing.constraint_hash(cv)
        return proj


async def attach_images(ws: Workspace, proj: Project) -> None:
    async with session_scope() as s:
        have = (await s.execute(select(ProductAsset).where(ProductAsset.project_id == proj.id))).scalars().all()
    roles = {h.role for h in have}
    if "product_photo" not in roles and PRODUCT_IMG.exists():
        data = PRODUCT_IMG.read_bytes()
        a = await assetsvc.save(workspace_id=ws.id, project_id=proj.id, kind="product_photo", data=data, mime="image/png",
                                source="synthetic_fixture", is_original=True,
                                label="SYNTHETIC placeholder product photo (AI-generated) — replace with the real product",
                                metadata={"usage_rights": "Generated for the demo by the project owner via xAI"})
        async with session_scope() as s:
            s.add(ProductAsset(project_id=proj.id, asset_id=a.id, role="product_photo", is_primary=True,
                               usage_rights="Synthetic placeholder generated for the demo"))
    if "logo" not in roles:
        a = await assetsvc.save(workspace_id=ws.id, project_id=proj.id, kind="logo", data=logo_png(), mime="image/png",
                                source="synthetic_fixture", is_original=True, label="Sample logo (synthetic)")
        async with session_scope() as s:
            s.add(ProductAsset(project_id=proj.id, asset_id=a.id, role="logo", usage_rights="Synthetic sample logo"))


async def main(product_image: bool) -> None:
    user, ws = await ensure_user(settings.SEED_USER, settings.SEED_PASSWORD, "Jury workspace", is_demo=True,
                                 cap=settings.DEMO_DAILY_COST_USD)
    if product_image and not PRODUCT_IMG.exists():
        await make_product_image()
    proj = await seed_project(ws, user)
    await attach_images(ws, proj)
    print(f"seeded user={settings.SEED_USER} workspace={ws.name} project={proj.id}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--product-image", action="store_true")
    asyncio.run(main(ap.parse_args().product_image))
