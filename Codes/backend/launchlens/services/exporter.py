"""Campaign package export (zip) with a manifest that matches the files.

Contents: strategy, evidence summary (derived and redistributable evidence only;
raw Qloo payloads are never exported), placement shortlist and brief, an outreach
DRAFT that is never sent, flyers, videos with thumbnails and subtitles, copy,
storyboard, and manifest.json listing every file with hash, size, type,
dimensions/duration and the strategy/brief versions it came from. Text files are
secret-scanned before the zip is written.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import uuid
import zipfile
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from ..config import settings
from ..db import session_scope
from ..models import (
    Asset, AudienceVersion, CreativeBrief, EvidenceRecord, Export, GeographicArea, PlacementCandidate, Project,
    ProductVersion, Storyboard, StrategyVersion,
)
from ..security import redact
from . import assets as assetsvc
from .evidence import BADGE


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")[:40] or "item"


class Package:
    def __init__(self):
        self.buf = io.BytesIO()
        self.zip = zipfile.ZipFile(self.buf, "w", zipfile.ZIP_DEFLATED)
        self.files: list[dict] = []

    def add(self, path: str, data: bytes, mime: str, **meta) -> None:
        if any(f["path"] == path for f in self.files):
            raise RuntimeError(f"duplicate export path {path}")
        if mime.startswith("text/") or mime in ("application/json", "text/csv"):
            text = data.decode("utf-8")
            clean = redact(text)
            for secret in settings.secret_values():
                if secret in clean:
                    raise RuntimeError("secret detected in export content")
            data = clean.encode("utf-8")
        self.zip.writestr(path, data)
        self.files.append({"path": path, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "mime": mime,
                           **{k: v for k, v in meta.items() if v is not None}})

    def text(self, path: str, text: str, mime: str = "text/markdown", **meta) -> None:
        self.add(path, text.encode("utf-8"), mime, **meta)

    def close(self, manifest: dict) -> bytes:
        self.zip.writestr("manifest.json", json.dumps(manifest, indent=2, default=str))
        self.zip.close()
        return self.buf.getvalue()


def _strategy_md(sv: StrategyVersion, area: str, aud: str, evidence: dict[str, EvidenceRecord], placements: dict) -> str:
    c = sv.content
    lines = [f"# Launch strategy — {area} × {aud} (v{sv.version})", "",
             f"Generated: {sv.created_at:%Y-%m-%d %H:%M} UTC · generator: {sv.generator.get('type')} {sv.generator.get('model', '')}", "",
             "> Planning document. Scores are application planning indices; KPIs are targets to test, not predictions.", "",
             "## Positioning", c.get("positioning", ""), "",
             f"## Main feature: {c.get('main_feature_key')}", _ref(c.get("main_feature_rationale"), evidence), "",
             "## Feature-emphasis hypotheses"] + [f"- {_ref(h, evidence)}" for h in c.get("feature_hypotheses", [])] + [
             "", "## Key messages"] + [f"- {_ref(m, evidence)}" for m in c.get("key_messages", [])] + [
             "", "## Supporting benefits"] + [f"- {_ref(m, evidence)}" for m in c.get("supporting_benefits", [])] + [
             "", "## Placement options (all unverified until confirmed)"]
    for p in c.get("placement_options", []):
        pc = placements.get(p["placement_id"])
        name = pc.name if pc else p["placement_id"]
        lines.append(f"- **{name}** — {p['rationale']}  ")
        for q in p.get("verification_questions", []):
            lines.append(f"  - To verify: {q}")
    lines += ["", "## Launch steps"] + [f"{i + 1}. {s['step']} ({s.get('timing', '')})" for i, s in enumerate(c.get("launch_steps", []))]
    pp = c.get("pilot_plan") or {}
    lines += ["", f"## Pilot plan ({pp.get('duration_weeks', '?')} weeks)", pp.get("objective", "")] + [f"- {s}" for s in pp.get("steps", [])]
    lines += ["", "Signals to watch:"] + [f"- {s}" for s in pp.get("success_signals", [])]
    lines += ["", "## KPIs to test (targets, not outcomes)"] + [f"- {k['metric']}: {k['target_to_test']}" for k in c.get("kpis_to_test", [])]
    b = sv.budget_scenario or {}
    lines += ["", "## Budget scenario (planning only — no observed prices)"]
    if b.get("lines"):
        lines += [f"| Placement | Channel | Amount ({b.get('currency')}) | Basis |", "|---|---|---|---|"]
        lines += [f"| {x['placement']} | {x['channel_type']} | {x['amount']:,.2f} | {x['basis']} |" for x in b["lines"]]
    else:
        lines.append(b.get("note", "No budget supplied."))
    lines += ["", "## Expected learning"] + [f"- {x}" for x in c.get("expected_learning", [])]
    lines += ["", "## Assumptions"] + [f"- {x}" for x in c.get("assumptions", [])]
    lines += ["", "## Limitations"] + [f"- {x}" for x in c.get("limitations", [])]
    lines += ["", "## Evidence referenced"] + [f"- `{i[:8]}` {evidence[i].title} [{BADGE.get(evidence[i].kind)}]" for i in sv.evidence_ids if i in evidence]
    return "\n".join(lines)


def _ref(r, evidence) -> str:
    if not r:
        return ""
    ids = [i for i in r.get("evidence_ids", []) if i in evidence]
    tag = f" _(evidence: {', '.join(i[:8] for i in ids)})_" if ids else " _(hypothesis)_"
    return r.get("text", "") + tag


async def build(project_id: uuid.UUID, workspace_id: uuid.UUID, export_id: uuid.UUID) -> dict:
    pkg = Package()
    async with session_scope() as s:
        project = await s.get(Project, project_id)
        pv = (await s.execute(select(ProductVersion).where(ProductVersion.project_id == project_id)
                              .order_by(ProductVersion.version.desc()).limit(1))).scalar_one_or_none()
        svs = (await s.execute(select(StrategyVersion).where(StrategyVersion.project_id == project_id,
                                                             StrategyVersion.stale.is_(False))
                               .order_by(StrategyVersion.created_at.desc()))).scalars().all()
        latest: dict = {}
        for sv in svs:
            latest.setdefault((sv.area_id, sv.audience_version_id), sv)
        svs = list(latest.values())
        areas = {a.id: a for a in (await s.execute(select(GeographicArea).where(GeographicArea.project_id == project_id))).scalars().all()}
        auds = {a.id: a for a in (await s.execute(select(AudienceVersion).where(AudienceVersion.project_id == project_id))).scalars().all()}
        ev_ids = {uuid.UUID(i) for sv in svs for i in sv.evidence_ids}
        evidence = {str(e.id): e for e in (await s.execute(select(EvidenceRecord).where(EvidenceRecord.id.in_(ev_ids)))).scalars().all()} if ev_ids else {}
        pl_ids = {uuid.UUID(p["placement_id"]) for sv in svs for p in sv.content.get("placement_options", [])}
        placements = {str(p.id): p for p in (await s.execute(select(PlacementCandidate).where(PlacementCandidate.id.in_(pl_ids)))).scalars().all()} if pl_ids else {}
        shortlisted = (await s.execute(select(PlacementCandidate).where(PlacementCandidate.project_id == project_id,
                                                                        PlacementCandidate.shortlisted.is_(True)))).scalars().all()
        briefs = (await s.execute(select(CreativeBrief).where(CreativeBrief.project_id == project_id, CreativeBrief.is_current.is_(True),
                                                              CreativeBrief.stale.is_(False)))).scalars().all()
        brief_assets = {b.id: (await s.execute(select(Asset).where(
            Asset.brief_id == b.id, Asset.deleted_at.is_(None), Asset.stale.is_(False),
            Asset.kind.in_(("flyer", "video_final", "video_animatic", "thumbnail", "subtitles"))).order_by(Asset.created_at))).scalars().all()
            for b in briefs}
        storyboards = {b.id: (await s.execute(select(Storyboard).where(Storyboard.brief_id == b.id)
                                              .order_by(Storyboard.version.desc()).limit(1))).scalar_one_or_none() for b in briefs}
    included = {"product_version": pv.version if pv else None, "strategies": [], "briefs": []}
    # strategies
    for sv in svs:
        area, aud = areas[sv.area_id].name, auds[sv.audience_version_id].name
        base = f"strategy/{_slug(area)}__{_slug(aud)}__v{sv.version}"
        pkg.text(base + ".md", _strategy_md(sv, area, aud, evidence, placements), strategy_version_id=str(sv.id))
        pkg.text(base + ".json", json.dumps({"content": sv.content, "budget_scenario": sv.budget_scenario,
                                             "evidence_ids": sv.evidence_ids, "version": sv.version}, indent=2, default=str),
                 "application/json", strategy_version_id=str(sv.id))
        included["strategies"].append({"id": str(sv.id), "area": area, "audience": aud, "version": sv.version})
    # evidence summary (exportable records only)
    rows = [e for e in evidence.values()]
    md = ["# Evidence summary", "", "Kinds: Supported (observed fact) · Owner-provided · Provider signal · Derived · Hypothesis · Demo · Unknown.",
          "Missing data is listed as Unknown and is not zero. Raw provider responses are not included.", ""]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "kind", "badge", "topic", "title", "statement", "value", "units", "source", "retrieved_at", "period", "limitations"])
    for e in sorted(rows, key=lambda e: (e.kind, e.topic)):
        statement = e.statement if e.redistributable else f"{e.title} (provider-derived summary; raw data not redistributed)"
        md.append(f"- **[{BADGE.get(e.kind)}]** {e.title} — {statement} _Source: {e.source}, {e.retrieved_at:%Y-%m-%d}._ {e.limitations}")
        w.writerow([str(e.id), e.kind, BADGE.get(e.kind), e.topic, e.title, statement,
                    float(e.value_numeric) if e.value_numeric is not None else "", e.units, e.source,
                    e.retrieved_at.isoformat() if e.retrieved_at else "", e.period, e.limitations])
    pkg.text("evidence/evidence_summary.md", "\n".join(md))
    pkg.add("evidence/evidence.csv", buf.getvalue().encode(), "text/csv")
    # placements
    plist = shortlisted or list(placements.values())
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["name", "channel", "category", "address", "status", "availability", "permission", "contact", "cost", "dates",
                "accessibility", "next_action", "source"])
    for p in plist:
        v = p.verification or {}
        w.writerow([p.name, p.channel_type, p.category, p.address, p.status, v.get("availability"), v.get("permission"),
                    v.get("contact"), v.get("cost"), v.get("dates"), p.accessibility, p.next_action, p.source])
    pkg.add("placements/placement_shortlist.csv", buf.getvalue().encode(), "text/csv")
    pkg.text("placements/placement_brief.md", "\n".join(
        ["# Placement brief", "", "Every placement below is a candidate. Availability, permission, contact, cost and dates are "
         "unknown unless marked verified. A place record is not an ad slot.", ""] +
        [f"## {p.name}\n- Channel: {p.channel_type} · {p.category}\n- Address: {p.address or 'n/a'}\n- Status: {p.status}\n"
         f"- Suggested activation: {p.activation}\n- Why: {p.relationship_note}\n- Next action: {p.next_action}\n"
         f"- Evidence needed: {p.evidence_needed}\n" for p in plist]))
    pkg.text("placements/outreach_draft.md", "\n".join(
        ["# Outreach draft — NOT SENT", "", "LaunchLens never contacts businesses. Review, personalise and send yourself.", "",
         f"Subject: Demonstration request — {pv.name if pv else project.name}", "",
         "Hello,", "", f"We are introducing {pv.name if pv else 'our product'} in your area and would like to ask whether you would "
         "consider a short in-person demonstration or displaying an information flyer. Could you tell us whether this is "
         "possible, which dates might suit, any costs, and who we should speak with?", "", "Thank you,", "[Your name]", ""]))
    # creative
    for b in briefs:
        area, aud = areas[b.area_id].name, auds[b.audience_version_id].name
        base = f"creative/{_slug(area)}__{_slug(aud)}__{b.language}__{_slug(b.angle)}__v{b.version}__{str(b.id)[:8]}"
        c = b.content
        pkg.text(base + "/copy.md", "\n".join([
            f"# Copy — {aud}, {area} ({b.language}) v{b.version}", f"Translation status: {b.translation_status}",
            f"Approval: {b.approval_state}", "", f"**Headline:** {c['headline']}", "", f"**Body:** {c['body']}", "",
            f"**CTA:** {c['cta']}", "", f"**Price:** {c.get('price_text') or '—'}", "",
            f"Message hierarchy: {', '.join(c.get('message_hierarchy', []))}", "",
            "## Creative decisions"] + [f"- {d['decision']} — {d['rationale']} [{d['kind']}]" for d in b.decisions]),
            brief_id=str(b.id), brief_version=b.version)
        pkg.text(base + "/brief.json", json.dumps({"identity": {"product_version_id": str(b.product_version_id), "area": area,
                                                                "audience": aud, "language": b.language, "channel": b.channel,
                                                                "objective": b.objective, "angle": b.angle},
                                                   "content": c, "decisions": b.decisions, "version": b.version},
                                                  indent=2, default=str), "application/json", brief_id=str(b.id))
        sb = storyboards.get(b.id)
        if sb:
            pkg.text(base + "/storyboard.json", json.dumps({"total_seconds": float(sb.total_seconds), "scenes": [
                {"idx": sc.idx, "kind": sc.kind, "purpose": sc.purpose, "shot": sc.shot_description,
                 "duration_s": float(sc.duration_s), "spoken": sc.spoken_copy, "on_screen": sc.on_screen_text,
                 "clip_asset_id": str(sc.clip_asset_id) if sc.clip_asset_id else None} for sc in sb.scenes]}, indent=2),
                "application/json", brief_id=str(b.id))
        # Latest version per group (flyer preset / video orientation); thumbnails
        # and subtitles only for the videos actually included.
        latest_by_group: dict[str, Asset] = {}
        for a in brief_assets.get(b.id, []):
            if a.group_key:
                latest_by_group[a.group_key] = a
        chosen = list(latest_by_group.values())
        video_ids = {str(a.id) for a in chosen if a.kind in ("video_final", "video_animatic")}
        chosen += [a for a in brief_assets.get(b.id, []) if a.kind in ("thumbnail", "subtitles")
                   and (a.lineage or {}).get("video_asset_id") in video_ids]
        folder = {"flyer": "flyers", "video_final": "videos", "video_animatic": "animatics_not_xai_video",
                  "thumbnail": "thumbnails", "subtitles": "subtitles"}
        for a in chosen:
            data = await assetsvc.load_bytes(a)
            ext = {"image/png": "png", "image/jpeg": "jpg", "video/mp4": "mp4", "text/vtt": "vtt",
                   "application/x-subrip": "srt"}.get(a.mime_type, "bin")
            tag = a.preset or _slug((a.metadata_ or {}).get("format") or a.label)
            name = f"{a.kind}_{tag}_v{a.version}_{str(a.id)[:8]}.{ext}"
            pkg.add(f"{base}/{folder.get(a.kind, a.kind)}/{name}", data, a.mime_type, asset_id=str(a.id), width=a.width,
                    height=a.height, duration_s=float(a.duration_s) if a.duration_s is not None else None,
                    approval_state=a.approval_state, source=a.source, label=a.label, brief_version=b.version,
                    video_asset_id=(a.lineage or {}).get("video_asset_id"))
        included["briefs"].append({"id": str(b.id), "version": b.version, "language": b.language, "audience": aud, "area": area})
    pkg.text("README.md", "\n".join([
        f"# {project.name} — campaign package", "", f"Exported {datetime.now(UTC):%Y-%m-%d %H:%M} UTC by LaunchLens.", "",
        "- strategy/: location × audience strategies with evidence references", "- evidence/: evidence summary (derived, exportable)",
        "- placements/: shortlist, placement brief and an outreach draft (not sent)",
        "- creative/: copy, brief, storyboard, flyers, videos, thumbnails and subtitles",
        "- manifest.json: every file with SHA-256, size, dimensions/duration and versions", "",
        "Assets marked needs_review or draft have not been approved by a person. Videos labelled 'animatic' are not xAI-generated video.",
        "Scores are planning indices; KPIs are targets to test. Nothing here guarantees results."]))
    manifest = {"export_id": str(export_id), "project": project.name, "created_at": datetime.now(UTC).isoformat(),
                "included_versions": included, "files": pkg.files,
                "notes": ["Raw Qloo responses are not redistributed.", "Outreach drafts were not sent."]}
    data = pkg.close(manifest)
    asset = await assetsvc.save(workspace_id=workspace_id, project_id=project_id, kind="export_bundle", data=data,
                                mime="application/zip", source="composed", label=f"Campaign package {datetime.now(UTC):%Y-%m-%d %H:%M}",
                                metadata={"files": len(pkg.files)})
    async with session_scope() as s:
        ex = await s.get(Export, export_id)
        ex.status, ex.asset_id, ex.manifest, ex.included_versions = "completed", asset.id, manifest, included
        ex.expires_at = datetime.now(UTC) + timedelta(days=30)
    return {"asset_id": str(asset.id), "files": len(pkg.files), "bytes": len(data)}
