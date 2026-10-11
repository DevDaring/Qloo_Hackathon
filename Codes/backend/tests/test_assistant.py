"""Floating assistant: plan → Qloo grounding → answer, read-only, tenant-safe (no network)."""
from __future__ import annotations

from launchlens.providers import llm, qloo
from launchlens.services import assistant

from .conftest import login, make_tenant


async def test_assistant_grounds_in_qloo_and_is_read_only(app, monkeypatch):
    await make_tenant("chat_a")
    c = await login(app, "chat_a")
    monkeypatch.setattr(qloo, "configured", lambda: True)
    calls = []

    async def structured(schema, system, user, **kw):
        calls.append(schema.__name__)
        if schema is assistant._Plan:
            return assistant._Plan(lookups=[assistant._Lookup(interest="Bad Bunny", target_type="brand")]), "fake/model"
        assert "QLOO DATA" in user and "Puma" in user  # the answer step sees the grounded Qloo results
        return assistant._Reply(answer="From Qloo: Bad Bunny fans also like Puma.", used_qloo=True,
                                links=[assistant._Link(label="Compare", page="compare"), assistant._Link(label="Bad", page="../admin")],
                                suggestions=["Which venues?"]), "fake/model"
    monkeypatch.setattr(llm, "structured", structured)

    async def search(q, types=None, take=8, budget=None):
        budget.take() if budget else None
        return [{"qloo_id": "BB", "name": "Bad Bunny", "type": "urn:entity:artist", "types": ["urn:entity:artist"]}], {}

    async def related(entity_type, *, entity_ids, tag_ids, take=8, budget=None):
        assert entity_type == "urn:entity:brand" and entity_ids == ["BB"]
        return [{"name": "Puma", "affinity": 0.9, "popularity": 0.8}], {}
    monkeypatch.setattr(qloo, "search", search)
    monkeypatch.setattr(qloo, "related", related)
    pid = (await c.post("/api/v1/projects", json={"name": "Chat project"})).json()["id"]
    r = await c.post("/api/v1/assistant/chat", json={"messages": [{"role": "user", "content": "Which brands do Bad Bunny fans like?"}],
                                                     "project_id": pid})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["used_qloo"] and d["qloo"][0]["results"][0]["name"] == "Puma" and d["qloo"][0]["signal"]["type"] == "artist"
    assert d["links"] == [{"label": "Compare", "to": f"/projects/{pid}/compare"}]  # unknown pages are dropped
    assert calls == ["_Plan", "_Reply"]
    # another tenant cannot attach someone else's project as context
    await make_tenant("chat_b")
    c2 = await login(app, "chat_b")
    r = await c2.post("/api/v1/assistant/chat", json={"messages": [{"role": "user", "content": "hi"}], "project_id": pid})
    assert r.status_code == 404
    r = await c2.post("/api/v1/assistant/chat", json={"messages": [{"role": "assistant", "content": "hi"}]})
    assert r.status_code == 422


async def test_runs_list_hides_comparison_runs(app):
    from launchlens.db import session_scope
    from launchlens.models import ResearchRun
    from .conftest import login as _login
    await make_tenant("runs_a")
    c = await _login(app, "runs_a")
    pid = (await c.post("/api/v1/projects", json={"name": "Runs"})).json()["id"]
    me = (await c.get("/api/v1/auth/me")).json()
    import uuid as _u
    async with session_scope() as s:
        ws = _u.UUID(me["workspace"]["id"])
        s.add(ResearchRun(project_id=_u.UUID(pid), workspace_id=ws, thread_id="t-real", status="completed"))
        await s.flush()
        s.add(ResearchRun(project_id=_u.UUID(pid), workspace_id=ws, thread_id="t-arm", status="completed",
                          qloo_enabled=False, experiment_label="without_qloo"))
    items = (await c.get(f"/api/v1/projects/{pid}/research-runs")).json()["items"]
    assert [r["experiment_label"] for r in items] == [""] and all(r["qloo_enabled"] for r in items)


async def test_many_correct_logins_are_fine_but_failed_ones_are_limited(app):
    import httpx
    await make_tenant("login_a")
    c = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
    for _ in range(15):  # judges on one network all signing in
        assert (await c.post("/api/v1/auth/login", json={"username": "login_a", "password": "pw-12345678"})).status_code == 200
    codes = [(await c.post("/api/v1/auth/login", json={"username": "login_a", "password": "wrong"})).status_code for _ in range(11)]
    assert codes[:10] == [401] * 10 and codes[10] == 429
