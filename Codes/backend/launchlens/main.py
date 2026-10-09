"""FastAPI application: `uvicorn launchlens.main:app`.

Serves /api/v1 and, in deployment, the built React app from frontend/dist
(single origin, so cookies and SSE need no CORS)."""
from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import errors
from .api import routes_creative, routes_insight, routes_project, routes_research
from .api.deps import guard_locked
from .config import CODES_DIR, settings
from .security import configure_logging

configure_logging()
# Not every host's MIME table knows these; static files must carry correct types (nosniff is on).
for _ext, _type in ((".webp", "image/webp"), (".mp4", "video/mp4"), (".webm", "video/webm"), (".woff2", "font/woff2")):
    mimetypes.add_type(_type, _ext)

app = FastAPI(title="LaunchLens API", version="1.0.0",
              description="Geographic market analysis, launch strategy and audience-specific ad generation with visible evidence.",
              openapi_url="/api/v1/openapi.json", docs_url="/api/docs", redoc_url=None)
errors.install(app)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
                   allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"], allow_headers=["content-type", "x-request-id"])


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


_guard = [Depends(guard_locked)]
app.include_router(routes_project.router, dependencies=_guard)
app.include_router(routes_research.router, dependencies=_guard)
app.include_router(routes_creative.router, dependencies=_guard)
app.include_router(routes_insight.router, dependencies=_guard)
app.include_router(routes_creative.health)

DIST = CODES_DIR / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="static-assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        if path.startswith("api/"):
            return JSONResponse({"error": {"code": "not_found", "message": "Unknown API route."}}, status_code=404)
        candidate = (DIST / path).resolve()
        if path and DIST in candidate.parents and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(DIST / "index.html", headers={"Cache-Control": "no-cache"})

_ = Path
