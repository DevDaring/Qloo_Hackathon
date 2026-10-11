"""Plain-language service health for ordinary users: what works, what it
means for their project, and what to do. No credential or variable names."""
from __future__ import annotations

OP_NAMES = {"search": "interest search", "tags": "interest tags", "insights_place_location": "place recommendations",
            "explainability": "recommendation explanations", "common_query_multipolygon": "city comparison",
            "heatmap": "taste heatmap", "structured_output": "strategy writing", "vision": "image checks",
            "image_generation": "image generation", "image_edit": "image editing", "video_generation": "video generation"}
ERROR_STATE = {"auth": ("key_rejected", "The service rejected the access key."),
               "rate_limited": ("busy", "The service is busy (too many requests)."),
               "transient": ("unreachable", "The service did not answer in time."),
               "unsupported": ("partial", "This account does not include that operation."),
               "failed": ("unreachable", "The service refused the request.")}


def _from_probe(name: str, pr: dict, *, what: str, impact_off: str, recovery_off: str, recovery_err: str,
                checked_at: str) -> dict:
    if "error" in pr and len(pr) == 1:
        return {"key": name, "state": "unreachable", "summary": f"Could not check {what}.", "impact": impact_off,
                "recovery": [recovery_err], "checked_at": checked_at}
    if not pr.get("configured"):
        return {"key": name, "state": "not_set_up", "summary": f"{what.capitalize()} is not set up.", "impact": impact_off,
                "recovery": [recovery_off], "checked_at": pr.get("checked_at") or checked_at}
    ops = pr.get("operations") or {}
    bad = {k: v for k, v in ops.items() if v != "supported"}
    if pr.get("authorized") is False:
        return {"key": name, "state": "key_rejected", "summary": f"{what.capitalize()} rejected the access key.",
                "impact": impact_off, "recovery": ["An administrator replaces the key in the server configuration."],
                "checked_at": pr.get("checked_at") or checked_at}
    if pr.get("reachable") is False:
        return {"key": name, "state": "unreachable", "summary": f"{what.capitalize()} is not reachable right now.",
                "impact": impact_off, "recovery": [recovery_err], "checked_at": pr.get("checked_at") or checked_at}
    works = [OP_NAMES.get(k, k) for k, v in ops.items() if v == "supported"]
    if bad:
        missing = [f"{OP_NAMES.get(k, k)} ({ERROR_STATE.get(v, ('', v.replace('_', ' ')))[1].rstrip('.').lower()})"
                   for k, v in bad.items()]
        return {"key": name, "state": "partial", "summary": f"{what.capitalize()} partly works: " + ", ".join(works or ["nothing verified"]) + ".",
                "impact": "Unavailable: " + "; ".join(missing) + ". The rest of the app keeps working and marks these gaps.",
                "recovery": ["Try “Check again” later.", recovery_err], "checked_at": pr.get("checked_at") or checked_at}
    return {"key": name, "state": "working", "summary": f"{what.capitalize()} is working" + (f": {', '.join(works)} verified." if works else "."),
            "impact": None, "recovery": [], "checked_at": pr.get("checked_at") or checked_at}


def build(data: dict, checked_at: str) -> list[dict]:
    out = []
    out.append({**_from_probe("qloo", data["qloo"], what="Qloo taste intelligence",
                              impact_off="Cities are compared on practical evidence only and marked incomplete; no taste stories.",
                              recovery_off="An administrator adds a Qloo key in the server configuration.",
                              recovery_err="If it persists, check Qloo's service status or the key's quota.", checked_at=checked_at),
                "name": "Qloo taste intelligence"})
    r = data["reasoning"]
    item = _from_probe("reasoning", r, what="Strategy and copy writing",
                       impact_off="Strategies and copy use simple built-in templates.",
                       recovery_off="An administrator adds a language-model key.",
                       recovery_err="Requests retry automatically; a backup model takes over when enabled.", checked_at=checked_at)
    if item["state"] == "working" and r.get("served_by") and r.get("served_by") != r.get("model"):
        item.update(state="backup", summary=f"Strategy and copy writing works through the backup model ({r['served_by']}).",
                    impact="The primary model is unavailable (for example, out of credit). Results are labelled with the model used.",
                    recovery=["An administrator restores the primary model's credit; nothing else is needed."])
    out.append({**item, "name": "Strategy and copy writing"})
    m = data["media"]
    item = _from_probe("media", m, what="Image and video generation",
                       impact_off="New ads cannot be generated; existing ads and exports still work.",
                       recovery_off="An administrator adds an image/video generation key.",
                       recovery_err="Try again later; nothing is charged for failed requests.", checked_at=checked_at)
    names = {"xai": "xAI Grok Imagine", "nanogpt": "NanoGPT", "openrouter": "OpenRouter"}
    chain = (m.get("image_chain") or []) if isinstance(m, dict) else []
    serving = m.get("serving") if isinstance(m, dict) else None
    order = " → ".join(names.get(c, c) for c in chain)
    if serving and chain and serving == chain[0]:
        item.update(state="working", summary=f"Image and video generation is working through {names.get(serving, serving)}.",
                    impact=f"Fallback order if it fails: {order}." if len(chain) > 1 else None, recovery=[])
    elif serving:
        item.update(state="backup", summary=f"Image and video generation works through the backup provider ({names.get(serving, serving)}).",
                    impact=f"{names.get(chain[0], chain[0])} is unavailable; order: {order}.",
                    recovery=["An administrator checks the primary provider's key or credit; nothing else is needed."])
    out.append({**item, "name": "Image and video generation"})
    n = data["narration"]
    out.append({"key": "narration", "name": "Voice-over", "state": "working" if n.get("configured") else "not_set_up",
                "summary": "Voice-over is available." if n.get("configured") else "Voice-over is not set up.",
                "impact": None if n.get("configured") else "Videos are delivered silent with captions.",
                "recovery": [] if n.get("configured") else ["An administrator adds a voice provider key."],
                "checked_at": checked_at, "verified": False})
    i = data["indic_language"]
    out.append({"key": "indic_language", "name": "Hindi and Bengali", "state": "working" if i.get("configured") else "not_set_up",
                "summary": "Hindi and Bengali translation and voice are available; translations are flagged for human review."
                if i.get("configured") else "Indian-language translation is not set up.",
                "impact": None if i.get("configured") else "Ads are produced in English only.",
                "recovery": [] if i.get("configured") else ["An administrator adds an Indian-language provider key."],
                "checked_at": checked_at, "verified": False})
    g = data["geo"]
    geo_ok = isinstance(g, dict) and (g.get("geocoding") or {}).get("reachable")
    out.append({"key": "geo", "name": "Maps, places and climate", "state": "working" if geo_ok else "unreachable",
                "summary": "Place search and maps are working." if geo_ok else "Place search did not answer.",
                "impact": None if geo_ok else "New research cannot locate cities; saved results still show.",
                "recovery": [] if geo_ok else ["These are free public services; try again in a few minutes."],
                "checked_at": checked_at})
    return out
