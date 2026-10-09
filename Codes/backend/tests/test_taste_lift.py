"""Cross-city taste lift (P0): zero/one/many results, sparse and not-comparable
states, unsorted responses, and areas outside the candidates. Pure: provider
and database are faked."""
from __future__ import annotations

import contextlib
import uuid

import pytest

from launchlens.services import research

AREAS = [{"area_id": "K", "name": "Kolkata", "lat": 22.57, "lon": 88.36, "radius_m": 8000},
         {"area_id": "D", "name": "Delhi", "lat": 28.61, "lon": 77.21, "radius_m": 8000},
         {"area_id": "C", "name": "Chennai", "lat": 13.08, "lon": 80.27, "radius_m": 8000}]
AUD = [{"id": str(uuid.uuid4()), "name": "A", "hash": "h"}]
ENTS = [{"audience_version_id": AUD[0]["id"], "status": "resolved", "qloo_id": "E1", "qloo_type": "urn:entity:brand"}]


def pts(area: str, n: int, tag: str):
    a = next(x for x in AREAS if x["area_id"] == area)
    return [{"qloo_id": f"{area}{tag}{i}", "lat": a["lat"] + 0.0005 * i, "lon": a["lon"], "affinity": None} for i in range(n)]


@pytest.fixture
def fake(monkeypatch):
    rec = []

    class S:
        def add(self, r):
            rec.append(r)

    @contextlib.asynccontextmanager
    async def scope():
        yield S()
    monkeypatch.setattr(research, "session_scope", scope)
    monkeypatch.setattr(research.qloo, "configured", lambda: True)
    state = {}

    async def common_places(wkt, *, entity_ids, tag_ids, pages=3, take=50, budget=None, context=None):
        out = state["signal"] if (entity_ids or tag_ids) else state["baseline"]
        return out, {"retrieved_at": None, "query_hashes": ["q"], "truncated": False}
    monkeypatch.setattr(research.qloo, "common_places", common_places)
    return state, rec


async def run(state):
    return await research.common_taste(uuid.uuid4(), uuid.uuid4(), AREAS, AUD, ENTS, budget=None, qloo_enabled=True)


async def test_concentration_gives_signed_lift_and_order_does_not_matter(fake):
    state, rec = fake
    state["baseline"] = pts("K", 10, "b") + pts("D", 10, "b") + pts("C", 10, "b")
    sig = pts("K", 25, "s") + pts("D", 4, "s") + pts("C", 1, "s")
    state["signal"] = list(reversed(sig))  # unsorted / reversed responses give the same counts
    out = await run(state)
    assert out["K"]["state"] == "available" and out["K"]["cultural_fit"] > 0 > out["D"]["cultural_fit"]
    assert rec and rec[0].topic == "taste_common" and rec[0].formula


async def test_sparse_area_is_not_scored(fake):
    state, _ = fake
    state["baseline"] = pts("K", 10, "b") + pts("D", 10, "b") + pts("C", 2, "b")
    state["signal"] = pts("K", 5, "s") + pts("D", 5, "s") + pts("C", 20, "s")
    out = await run(state)
    assert out["C"]["state"] == "sparse" and out["C"]["cultural_fit"] is None  # thin coverage never looks confident
    assert out["K"]["state"] == "available"


async def test_one_scorable_area_is_not_comparable(fake):
    state, _ = fake
    state["baseline"] = pts("K", 10, "b") + pts("D", 1, "b")
    state["signal"] = pts("K", 3, "s")
    out = await run(state)
    assert {v["state"] for v in out.values()} == {"not_comparable"}
    assert all(v["cultural_fit"] is None for v in out.values())


async def test_zero_signal_results_are_empty_not_zero(fake):
    state, _ = fake
    state["baseline"] = pts("K", 10, "b") + pts("D", 10, "b") + pts("C", 10, "b")
    state["signal"] = []
    out = await run(state)
    assert all(v["cultural_fit"] is None for v in out.values())
    assert all(v["by_audience"][AUD[0]["id"]]["state"] == "empty" for v in out.values())


async def test_results_outside_candidates_are_counted_separately(fake):
    state, rec = fake
    state["baseline"] = pts("K", 10, "b") + pts("D", 10, "b") + [{"qloo_id": "far", "lat": 0.0, "lon": 0.0}]
    state["signal"] = pts("K", 10, "s") + pts("D", 10, "s") + [{"qloo_id": "far2", "lat": 0.0, "lon": 0.0},
                                                               {"qloo_id": "nolat", "lat": None, "lon": None}]
    await run(state)
    assert rec[0].scope["outside_areas"] == {"signal": 1, "baseline": 1}
