"""LangGraph Postgres checkpointer in its own schema (`langgraph`), separate
from the application tables. LangGraph manages its own migrations via
`setup()`; retention is handled by `prune()` (deletes checkpoints of runs that
finished more than N days ago)."""
from __future__ import annotations

from contextlib import asynccontextmanager

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from ..config import settings

_pool: AsyncConnectionPool | None = None
_ready = False


async def _ensure_schema() -> None:
    import psycopg
    async with await psycopg.AsyncConnection.connect(settings.sync_database_url, autocommit=True) as conn:
        await conn.execute(f'CREATE SCHEMA IF NOT EXISTS "{settings.LANGGRAPH_SCHEMA}"')


async def pool() -> AsyncConnectionPool:
    global _pool
    if _pool is None:
        await _ensure_schema()
        _pool = AsyncConnectionPool(
            settings.sync_database_url, min_size=1, max_size=6, open=False,
            kwargs={"autocommit": True, "row_factory": dict_row, "prepare_threshold": 0,
                    "options": f"-c search_path={settings.LANGGRAPH_SCHEMA}"})
        await _pool.open()
    return _pool


@asynccontextmanager
async def saver():
    global _ready
    p = await pool()
    cp = AsyncPostgresSaver(p)
    if not _ready:
        await cp.setup()  # idempotent; runs LangGraph's own migrations once per process
        _ready = True
    yield cp


async def setup() -> None:
    async with saver():
        pass


async def prune(thread_ids: list[str]) -> int:
    n = 0
    async with saver() as cp:
        for t in thread_ids:
            await cp.adelete_thread(t)
            n += 1
    return n


async def close() -> None:
    global _pool, _ready
    _ready = False
    if _pool is not None:
        await _pool.close()
        _pool = None
