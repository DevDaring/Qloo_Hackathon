# LaunchLens

**Find where your product fits. Prove why. Ship the ads.**

LaunchLens is an agentic launch-planning application built for the **Qloo Agentic Hackathon**. Describe a product
and its audiences, and LaunchLens does the following:

- Researches candidate cities with practical evidence and **Qloo taste signals**.
- Ranks locations without letting taste override hard constraints.
- Shortlists venues and partners to approach.
- Writes evidence-linked launch strategies.
- Produces audience-specific flyers and video ads in English, Spanish, Hindi and Bengali.

Every recommendation shows the evidence behind it, and unknown data stays visibly unknown.

- **Live demo:** https://launchlens.koushikdeb.com
- **Jury login:** username `TestUser`, password `TestUser11` (shown on the sign-in page as well).

The jury workspace contains two labelled, read-only sample projects with synthetic product facts:

- **United States sample — Pulse Go portable speaker:** Phoenix, New York and Houston (Houston is outside
  launch-partner coverage); English and Spanish ads; record stores, music venues, cafés and campuses as partners.
- **India sample — Breeze IoT power wheelchair:** Kolkata, New Delhi and Chennai (Chennai is outside service
  coverage); Bengali, Hindi and English ads.

Both have real recorded research (OpenStreetMap, ERA5 climate, live Qloo), strategies, flyers and generated video
ads. Use **Duplicate to edit** to change anything. Live generation in that workspace is capped per day.

---

## What Qloo changes, and why you can trust it

The key claim LaunchLens demonstrates is **"Qloo changes a decision for a traceable reason."**

| Stage | How Qloo is used |
|---|---|
| Audience interests | Voluntary interests (e.g. *cricket, Rabindra Sangeet, street food*) are resolved with `/search` and `/v2/tags`. Ambiguous matches pause the agent for a human choice or an explicit proxy with a stated reason. Localities, destinations and venues are never accepted as taste signals. A missing entity is never replaced silently. |
| Location ranking | Hard constraints come first (service coverage, budget, distribution). Cultural fit is a **taste lift**: one common Qloo query over all candidate cities with the audience's signals, compared with the same query without signals. A city that appears more often among taste-matched places than in the baseline gets a positive log2 lift. Sparse cities are labelled, and missing components leave an index *incomplete* rather than renormalised. |
| Venue and partner shortlist | Qloo place-category tags (pharmacies, hospitals, malls, community and senior centres, physiotherapists, mobility and medical suppliers) are ranked by affinity per audience. Suitability = category fit + proximity + rank-normalised Qloo affinity. |
| Taste layer | A Qloo heatmap (`urn:heatmap`) on the map, labelled *relative within this query only — not demand*. |
| "Why this place?" | A taste-to-campaign story per audience and city: interests → Qloo recommendations → shortlisted place → campaign hypothesis → creative. Where Qloo explainability attributes a recommendation to an input, that edge is drawn with its evidence; otherwise the place is shown as "recommended for this combined interest set", with no invented weights. Model-written hypotheses are labelled as generated. |
| Experiment ("See what Qloo changed") | The with/without-Qloo comparison starts from the baseline run's frozen inputs and copies its practical evidence, then verifies per-city fingerprints. Edits after the baseline cannot leak in, and an invalid comparison says so. It reports ranking changes, venue discovery and creative emphasis separately, with blind A/B ratings, and says plainly when there is no material change. |

Qloo affinity is always presented with its provider meaning. It is a relative taste relationship, never demand,
footfall, purchase probability or a disability signal. Raw Qloo responses stay server-side and are never exported.

## Features

- **Product brief:** structured facts and features (mechanism, benefit, operating conditions, evidence status,
  prohibited exaggerations, critical unknowns), approved claims, uploads and versioning.
- **Launch constraints:** geocoded candidate cities with disambiguation, service regions, exclusions, separate
  production and ad-spend budgets, and scoring weights.
- **Agentic research workflow (LangGraph):** intake validation, entity resolution, geographic research, taste
  analysis, market evaluation, placement research, then strategy, creative, images, video, quality review and
  export. The workflow pauses for user decisions and is durable across restarts (PostgreSQL checkpoints).
- **Market explorer:** MapLibre map with clustered places (OSM and Qloo sources), a synchronized list, filters, an
  evidence drawer, a comparison tray, saved areas, a table fallback, and charts computed from the same bounded
  dataset.
- **Location comparison:** hard-constraint chips, component contributions, practical rank versus planning index,
  explicit "incomplete" states, a revision diff, and the with/without-Qloo experiment.
- **Campaign strategy:** for each location × audience, positioning, two feature-emphasis hypotheses, key messages
  with evidence references, a placement shortlist (every placement stays *availability unknown* until verified),
  pilot plan, KPIs-to-test and a deterministic budget scenario.
- **Ad studio:**
  - Audience-specific briefs.
  - Translation by Sarvam AI with brand names protected; every translation carries a back-translation and needs
    review.
  - Flyers: a Grok Imagine background (via NanoGPT), the real product photo composited, and deterministic typography (Indic shaping
    with libraqm) in 1080×1080, 1080×1350 and 1080×1920.
  - Videos: a Grok Imagine image-to-video storyboard (via NanoGPT) assembled with FFmpeg into 15–20 s vertical and landscape MP4s, with
    burned-in captions, the real-product end card and optional narration that needs review (Sarvam Bulbul for
    hi/bn).
  - A vision fidelity gate rejects generated imagery that shows things it must not before any video money is
    spent.
- **Explanations:** "Why this place?" taste story, two-audience comparison on the same city and inputs, "Why this
  message?" creative trace back to product facts, strategy and evidence, a *Pilot hypothesis* card (planned, never
  shown as a result), and up to three underexplored opportunities (affinity and popularity shown separately).
- **Ask LaunchLens assistant:** a floating chat on every signed-in page answers app and marketing questions. Taste
  questions ("which brands do Bad Bunny fans like?", "where in New York would Taylor Swift fans go?") are grounded in
  live Qloo Insights, shown as separate "Qloo data" cards next to the AI-written answer.
- **Guided journey:** Brief → Audience → Explore → Strategy → Create → Export on every page, with blockers that link
  to the exact field or decision and one next action.
- **Read-only jury sample:** the sample project is locked so every visitor sees the same results. **Duplicate to
  edit** copies its inputs and decisions into your own project; research re-runs cheaply from cache.
- **Exports:** a campaign zip with strategy, evidence summary, placement shortlist and brief, outreach *draft*
  (never sent), creative and subtitles, plus a manifest with a SHA-256 for every file.
- **Revisions:** exclude a city, change the budget, remove a feature, or change an audience's role. A dry-run
  preview lists exactly what would go stale before anything is applied. Only the affected outputs go stale, previous versions are kept, and a "what changed" diff is shown.
- **Cost controls:** reserve-then-settle accounting with per-job, per-run, per-workspace and daily caps, provider-
  reported actual costs, and a paid-attempt ledger. A crash never pays twice for the same request; ambiguous
  submissions require reconciliation.

Nothing is bought, published or sent automatically.

## Architecture

```
React + TypeScript (Vite, MapLibre GL 5, Recharts, Framer Motion)
        │  cookie session · /api/v1 · Server-Sent Events
FastAPI (Python 3.12, Pydantic) ──── PostgreSQL 16 + PostGIS ──── Durable worker (LangGraph, PostgreSQL job queue)
                                     • app tables (Alembic)        • Qloo · OpenAI/xAI Grok reasoning · Grok Imagine via NanoGPT
                                     • LangGraph checkpoints       • Sarvam AI · Fish Audio · OpenStreetMap · Open-Meteo
                                     • provider cache, cost ledger • Pillow composition · FFmpeg assembly
```

| Concern | Choice |
|---|---|
| Frontend | React 18 + TypeScript, Vite, MapLibre GL (globe intro and maps), Recharts, Framer Motion, Tailwind |
| Backend | FastAPI, SQLAlchemy 2 (asyncpg), Alembic, GeoAlchemy2/PostGIS |
| Agent workflow | LangGraph with the PostgreSQL checkpointer (schema `langgraph`), interrupts for human decisions |
| Taste intelligence | Qloo Insights API (hackathon environment) |
| Reasoning | `openai/gpt-4.1-mini` through **NanoGPT** (two keys) → **OpenRouter** (two accounts) → xAI Grok |
| Images and video | Grok Imagine (`grok-imagine-image`, `grok-imagine-video`) through **NanoGPT** (two keys); image fallback via **OpenRouter** (two accounts, `google/gemini-2.5-flash-image`); direct xAI last |
| Indian languages | Sarvam AI (Mayura translation, Bulbul v3 narration); Fish Audio and fal as narration fallbacks |
| Practical data | OpenStreetMap via Overpass (places), Nominatim (geocoding), Open-Meteo ERA5 archive (climate), OpenFreeMap tiles, NASA Blue/Black Marble imagery (landing globe) |
| Jobs | PostgreSQL jobs with atomic `SKIP LOCKED` claims, leases, heartbeats, idempotency keys and deadlines |

### Evidence model

Seven kinds are kept distinct in storage, reasoning, UI and exports:

- **Supported** (observed fact)
- **Owner-provided** fact
- **Provider signal** (Qloo)
- **Derived** metric (with formula)
- **Hypothesis**
- **Demo** (synthetic fixture)
- **Unknown** (an explicit data gap: noise, footfall, income, verified accessibility and ad inventory are recorded
  as unknown, never zero)

Model-cited evidence goes through short aliases and is validated against the project. Unknown IDs are dropped, and
unsupported claims (decibels, clinical or certification language, superlatives, removed features) are blocked
before any media is generated.

## Repository layout

```
Codes/
  backend/        FastAPI app and worker code (launchlens/), Alembic migrations, tests
    launchlens/api/        REST routes (/api/v1), schemas, ownership checks
    launchlens/graph/      LangGraph workflow and Postgres checkpointer
    launchlens/providers/  qloo, llm (OpenAI/OpenRouter/xAI), nanogpt + media router, xai, sarvam, voice, geo
    launchlens/services/   evidence, scoring, research, strategy, creative, compose, video,
                           production, exporter, costs, jobs, revisions, hashing, cache
    launchlens/worker/     durable job worker
    launchlens/demo/       seed for the jury workspace and sample project
  frontend/       React app (src/), Playwright e2e tests (e2e/), landing assets (public/landing)
  worker/         worker launcher
  database/       PostgreSQL provisioning SQL
  contracts/      OpenAPI specification shared with the frontend type generator
  deploy/         Dockerfile, docker-compose, provider pricing, host deployment (Caddy, cron, backups)
  assets/fonts/   Noto Sans (Latin, Devanagari, Bengali), SIL OFL
  scripts/        local process manager
  LICENSE         MIT
```

## Running locally

Requirements: Python 3.12, Node 20, PostgreSQL 16 with PostGIS 3, FFmpeg, and libraqm.

```bash
cd Codes
cp .env.example .env                       # fill in keys (see below)
# as a PostgreSQL superuser:
psql -v app_password='change-me' -f database/provision.sql

cd backend
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.lock
.venv/bin/alembic upgrade head
.venv/bin/python -m launchlens.demo.seed   # jury user + sample project
cd ..

scripts/dev.sh start all                   # API on :8140 + worker
cd frontend && npm ci && npm run dev       # http://127.0.0.1:5173 (proxies /api to :8140)
```

To use Docker instead, run `docker compose -f deploy/docker-compose.yml up --build`. This starts PostGIS, the
migrations and seed, the API serving the built frontend, and the worker.

### Configuration

All keys stay server-side in `.env`; the browser receives only map style, languages and the upload limit.
`Codes/.env.example` lists every variable with a placeholder.

| Required | Optional |
|---|---|
| `DATABASE_URL`, `AUTH_SECRET` | `LLM_ALLOW_FALLBACK`, `LLM_FALLBACK_PROVIDER=xai\|openrouter` |
| `QLOO_API_KEY`, `QLOO_BASE_URL` (`https://hackathon.api.qloo.com`) | `SARVAM_API_KEY` (Hindi/Bengali translation and voice) |
| `OPENAI_API_KEY` | `TTS_API_KEY` (Fish Audio), `FAL_KEY` |
| `XAI_API_KEY` (images, video, reasoning fallback) | `GEOCODING_*`, `PLACES_*`, `WEATHER_*`, `MAP_STYLE_URL`, `STORAGE_BACKEND`, `S3_*` |
| | Limits: `MAX_*`, `DEMO_*`, `WORKER_CONCURRENCY`, `JOB_LEASE_SECONDS` |

## Tests

```bash
cd Codes/backend && .venv/bin/python -m pytest -q        # offline: unit + PostgreSQL integration + full workflow with provider fakes
LAUNCHLENS_LIVE=1 .venv/bin/python -m pytest tests/live  # live smoke checks: Qloo, xAI, reasoning, geocoding, Sarvam
cd Codes/frontend && npx playwright test                 # browser end-to-end on the sample project
```

The offline tests cover the core guarantees:

- Hard constraints beat affinity.
- Incomplete evidence is never renormalised.
- Noise data stays unknown.
- Tenant isolation, and no secrets in responses or exports.
- Concurrent cost caps.
- Crash recovery without paying twice.
- Experiments: baseline from another project or without taste evidence is refused; edits after the baseline do
  not change the experiment; swapped city evidence is detected; blind ratings stay blind until both are rated.
- Taste story: per-input Qloo attribution only when Qloo provides it, otherwise the combined-set fallback; every
  provider edge resolves to project evidence.
- The locked sample refuses edits but allows export and duplication.
- Reconciliation of ambiguous submissions.
- Selective invalidation.
- Export manifest integrity.
- Indic glyph coverage.
- A Qloo-enabled run that becomes complete and ranked.
- The with/without-Qloo experiment holding practical evidence constant.

Live provider checks are kept separate from offline results.

## Deployment

The live instance runs on a single Ubuntu host:

- Caddy for TLS, proxying to uvicorn on `127.0.0.1:8140`.
- The durable worker.
- Native PostgreSQL 16 + PostGIS.
- A cron watchdog and nightly database and media backups.

`Codes/deploy/host/deploy.sh` syncs, installs, builds, migrates, seeds, restarts and installs the Caddy block in
one command.

## Honest limitations

- Scores are **planning indices** and KPIs are targets to test. Nothing here predicts sales or proves that a
  recommendation improves campaign outcomes; that needs a measured pilot. Pilot results can be imported on the
  Results page.
- OpenStreetMap coverage varies by city, so counts describe the retrieved set, not a census. Qloo affinity is
  relative within its query context.
- Translations and narration are machine-made and flagged for review. Generated people and places in creative are
  fictional. The landing page's portraits are AI-generated illustrations, and its ads are real sample outputs.
- The sample product's specifications are synthetic placeholders.

## License

Application code: MIT (see `Codes/LICENSE`). Fonts: SIL Open Font License. Data returned by providers (Qloo,
OpenStreetMap/ODbL, Open-Meteo/CC BY 4.0, NASA imagery, xAI, OpenAI, Sarvam) and user uploads keep their own
terms. Qloo response data is not stored in this repository.
