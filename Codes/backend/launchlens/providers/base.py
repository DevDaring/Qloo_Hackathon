"""Shared provider plumbing: error classes and a bounded-retry HTTP helper.

Classification matters more than retrying: authentication failures, invalid
input and unsupported capabilities fail at once with an actionable message;
only transient failures (429 / 5xx / network) are retried, with jitter and
Retry-After. A *paid* submission that times out is never retried here: it is
raised as `submission_unknown` so the caller can reconcile instead of paying
twice.
"""
from __future__ import annotations

import asyncio
import logging
import random
from typing import Any

import httpx

from ..security import redact

log = logging.getLogger("launchlens.providers")


class ProviderError(Exception):
    KINDS = ("not_configured", "auth", "invalid_input", "unsupported", "transient", "rate_limited",
             "policy_refusal", "submission_unknown", "not_found", "failed")

    def __init__(self, provider: str, kind: str, message: str, *, status: int | None = None,
                 retry_after: float | None = None, remote_id: str | None = None):
        assert kind in self.KINDS, kind
        super().__init__(f"{provider}: {message}")
        self.provider, self.kind, self.message = provider, kind, redact(message)
        self.status, self.retry_after, self.remote_id = status, retry_after, remote_id

    @property
    def retryable(self) -> bool:
        return self.kind in ("transient", "rate_limited")

    def as_dict(self) -> dict:
        return {"provider": self.provider, "kind": self.kind, "message": self.message, "status": self.status,
                "retryable": self.retryable}


def classify(provider: str, resp: httpx.Response) -> ProviderError:
    body = redact(resp.text[:400])
    s = resp.status_code
    if s == 403 and "permission to access" in body.lower():
        # e.g. Qloo: "You do not have permission to access urn:entity:..." = capability not enabled for this key
        return ProviderError(provider, "unsupported", f"not enabled for this key: {body}", status=s)
    if s in (401, 403):
        return ProviderError(provider, "auth", f"credential rejected (HTTP {s}). Check the key and base URL in .env.", status=s)
    if s == 404:
        return ProviderError(provider, "not_found", f"not found (HTTP 404): {body}", status=s)
    if s == 429 and ("insufficient_quota" in body or "credit_balance" in body or "no credits" in body.lower()):
        # Out of credits/quota is not a rate limit: retrying cannot help.
        return ProviderError(provider, "failed", "account has no credits or quota left; add credits with the provider",
                             status=s)
    if s == 429:
        ra = resp.headers.get("retry-after")
        try:
            after = float(ra) if ra else None
        except ValueError:
            after = None
        return ProviderError(provider, "rate_limited", "rate limited (HTTP 429)", status=s, retry_after=after)
    if s in (400, 409, 413, 415, 422):
        low = body.lower()
        if "not supported" in low or "unsupported" in low or "does not support" in low:
            return ProviderError(provider, "unsupported", f"capability not supported: {body}", status=s)
        if "moderation" in low or "policy" in low or "safety" in low:
            return ProviderError(provider, "policy_refusal", f"refused by provider policy: {body}", status=s)
        return ProviderError(provider, "invalid_input", f"rejected input (HTTP {s}): {body}", status=s)
    if s >= 500:
        return ProviderError(provider, "transient", f"provider error (HTTP {s})", status=s)
    return ProviderError(provider, "failed", f"unexpected HTTP {s}: {body}", status=s)


async def request(provider: str, method: str, url: str, *, headers: dict | None = None, params: Any = None,
                  json: Any = None, timeout: float = 30.0, attempts: int = 3, paid: bool = False,
                  client: httpx.AsyncClient | None = None) -> httpx.Response:
    """One HTTP call with bounded retries. Returns the 2xx response."""
    last: ProviderError | None = None
    own = client is None
    client = client or httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=min(15.0, timeout)))
    try:
        for attempt in range(1, attempts + 1):
            try:
                resp = await client.request(method, url, headers=headers, params=params, json=json)
            except (httpx.ReadTimeout, httpx.WriteTimeout, httpx.RemoteProtocolError) as e:
                if paid:
                    # The request may have reached the provider and been billed.
                    raise ProviderError(provider, "submission_unknown",
                                        f"no response after sending a paid request ({type(e).__name__}); "
                                        "outcome unknown") from None
                last = ProviderError(provider, "transient", f"network timeout ({type(e).__name__})")
            except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout) as e:
                # Never reached the provider: safe to retry even when paid.
                last = ProviderError(provider, "transient", f"could not connect ({type(e).__name__})")
            else:
                if resp.is_success:
                    return resp
                last = classify(provider, resp)
                if not last.retryable:
                    raise last
            if attempt < attempts:
                base = last.retry_after if (last and last.retry_after) else min(20.0, 1.5 * 2 ** (attempt - 1))
                await asyncio.sleep(base + random.uniform(0, base / 2))
        assert last is not None
        raise last
    finally:
        if own:
            await client.aclose()
