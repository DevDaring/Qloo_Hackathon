"""Verified, step-by-step guides the assistant can show for common tasks.

The model only chooses WHICH guide applies; the steps themselves are fixed
here, name the exact buttons on screen and point at real pages and anchors,
so an answer can never describe controls that do not exist. The chat renders
each step with an annotated screenshot (frontend/public/guide/<key>/<n>.webp)
and a "Show me" button that opens the page and highlights the control.
`to` is relative to the project (or "/settings", "/projects"); `#anchor` is the
element the app highlights.
"""
from __future__ import annotations

GUIDES: dict[str, dict] = {
    "create_video": {
        "title": "Make a video ad",
        "needs": "A creative brief. On a read-only sample, press “Duplicate to edit” first.",
        "steps": [
            {"text": "Open **Ad studio** from the left menu.", "to": "studio"},
            {"text": "In **Audience variants**, click the ad you want as a video (each card is one audience and language).", "to": "studio#variants"},
            {"text": "Below the preview, open the **Video** tab.", "to": "studio?tab=video#video-tab"},
            {"text": "Click **Generate video…**. A cost review opens; nothing is spent yet.", "to": "studio?tab=video#generate-video"},
            {"text": "Choose **Full generated video**, tick **Vertical 9:16** and/or **Landscape 16:9**, set a spending cap, tick the confirmation and press **Spend up to … & generate**."},
            {"text": "Progress shows right there, scene by scene. You get a notification with **View** when the MP4 is ready, usually in 1–3 minutes."},
        ],
    },
    "create_flyers": {
        "title": "Make flyers (image ads)",
        "needs": "A creative brief. On a read-only sample, press “Duplicate to edit” first.",
        "steps": [
            {"text": "Open **Ad studio** from the left menu.", "to": "studio"},
            {"text": "In **Audience variants**, click the ad you want to produce.", "to": "studio#variants"},
            {"text": "Click **Generate flyers…** next to the preview.", "to": "studio#generate-flyers"},
            {"text": "Pick the formats (square, portrait, vertical), set a spending cap, tick the confirmation and generate."},
            {"text": "Each format appears when ready (about 20 seconds each). Open one to zoom, then approve it in **Assets & exports**."},
        ],
    },
    "new_brief": {
        "title": "Write a new creative brief",
        "needs": "A campaign strategy (created after research, when you choose cities and audiences).",
        "steps": [
            {"text": "Open **Ad studio** from the left menu.", "to": "studio"},
            {"text": "Click **New brief from strategy** (top right).", "to": "studio#new-brief"},
            {"text": "The strategy for your current city and audience is preselected. Choose the language, channel and angle, then press **Draft brief**."},
            {"text": "The new brief appears as a card in **Audience variants** in a few seconds."},
        ],
    },
    "start_research": {
        "title": "Start research",
        "needs": "A saved product brief, candidate cities and at least one audience. Not possible on a read-only sample.",
        "steps": [
            {"text": "Open **Market explorer** from the left menu.", "to": "explorer"},
            {"text": "Click **Start research**.", "to": "explorer#start"},
            {"text": "A progress panel shows each step and the first results within seconds. You can keep working; you'll be notified."},
            {"text": "When it asks, press **Choose cities & audiences** to pick what gets a strategy."},
        ],
    },
    "choose_targets": {
        "title": "Choose cities and audiences for strategies",
        "needs": "Your own project (on a read-only sample, press “Duplicate to edit” first) with a research run waiting for your choice.",
        "steps": [
            {"text": "Press **Decide** (top banner or run console), or **Choose cities & audiences** in the progress panel.", "to": "#decision"},
            {"text": "Tick the city × audience pairs you want to plan for. Excluded cities can't be selected."},
            {"text": "Confirm. Strategies are written in parallel and appear in **Campaign strategy**.", "to": "strategy"},
        ],
    },
    "taste_story": {
        "title": "See why Qloo picked these places",
        "steps": [
            {"text": "Open **Audience insights** from the left menu.", "to": "audiences"},
            {"text": "In **Why these places?**, pick an audience and a city.", "to": "audiences#taste-story"},
            {"text": "Hover an interest to see which places Qloo linked to it; click a place for its affinity, popularity and what still needs checking."},
        ],
    },
    "compare_audiences": {
        "title": "Compare two audiences",
        "steps": [
            {"text": "Open **Audience insights** from the left menu.", "to": "audiences"},
            {"text": "Switch to the **Compare two audiences** tab and pick the two audiences and a city.", "to": "audiences#taste-story"},
            {"text": "Venues found only for A, only for B, or both are listed side by side, with each audience's interests."},
        ],
    },
    "export_package": {
        "title": "Download the campaign package",
        "steps": [
            {"text": "Open **Assets & exports** from the left menu.", "to": "assets"},
            {"text": "Click **Build package**.", "to": "assets#build-package"},
            {"text": "When it's ready (a few seconds), download the zip: strategy, evidence, placements, briefs, ads and a manifest."},
        ],
    },
    "duplicate_sample": {
        "title": "Make an editable copy of a sample",
        "steps": [
            {"text": "Open the sample project.", "to": ""},
            {"text": "Press **Duplicate to edit** in the read-only banner at the top.", "to": "#duplicate"},
            {"text": "Your copy opens. Press **Start research** there; cached data makes it take only a few seconds."},
        ],
    },
    "provider_status": {
        "title": "Check which AI services are working",
        "steps": [
            {"text": "Open **Settings / status** from the left menu.", "to": "/settings"},
            {"text": "Each service shows Working, Backup or a problem in plain English, with what to do and when it was last checked."},
        ],
    },
}


def resolve(key: str | None, project_id) -> dict | None:
    g = GUIDES.get(key or "")
    if not g:
        return None
    steps = []
    for i, st in enumerate(g["steps"], start=1):
        to = st.get("to")
        if to is None:
            link = None
        elif to.startswith("/"):
            link = to
        elif project_id:
            link = f"/projects/{project_id}" + (("/" + to) if to and not to.startswith("#") else to)
        else:
            link = None
        steps.append({"n": i, "text": st["text"], "to": link, "image": f"/guide/{key}/{i}.webp"})
    return {"key": key, "title": g["title"], "needs": g.get("needs"), "steps": steps}
