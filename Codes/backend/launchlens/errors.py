"""One error shape for every endpoint: request id, code, message, retryability
and field errors. Provider payloads are never echoed back."""
from __future__ import annotations

import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("launchlens.errors")


class AppError(Exception):
    def __init__(self, status: int, code: str, message: str, *, retryable: bool = False,
                 fields: dict | None = None, details: dict | None = None):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message
        self.retryable, self.fields, self.details = retryable, fields or {}, details or {}


def request_id(request: Request) -> str:
    rid = getattr(request.state, "request_id", None)
    if not rid:
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        request.state.request_id = rid
    return rid


def _body(request: Request, code: str, message: str, retryable: bool, fields: dict | None = None,
          details: dict | None = None) -> dict:
    return {"error": {"request_id": request_id(request), "code": code, "message": message,
                      "retryable": retryable, "fields": fields or {}, "details": details or {}}}


def install(app: FastAPI) -> None:
    @app.middleware("http")
    async def _rid(request: Request, call_next):
        rid = request_id(request)
        response = await call_next(request)
        response.headers["x-request-id"] = rid
        return response

    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError):
        return JSONResponse(_body(request, exc.code, exc.message, exc.retryable, exc.fields, exc.details),
                            status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError):
        fields: dict[str, str] = {}
        for e in exc.errors():
            loc = ".".join(str(x) for x in e.get("loc", []) if x not in ("body", "query", "path"))
            fields[loc or "_"] = e.get("msg", "invalid")
        return JSONResponse(_body(request, "validation_error", "Some fields need attention.", False, fields),
                            status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException):
        return JSONResponse(_body(request, "http_error", str(exc.detail), False), status_code=exc.status_code)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        from .security import redact
        log.error("unhandled error %s: %s", request_id(request), redact(repr(exc)))
        return JSONResponse(_body(request, "internal_error", "Something went wrong on our side.", True),
                            status_code=500)
