"""Alembic environment. The URL comes from the typed settings, never from
alembic.ini, so credentials stay in .env. LangGraph's checkpoint tables live in
their own schema and are managed by LangGraph's own setup, so they are
excluded here."""
import asyncio

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

from launchlens import models  # noqa: F401  (registers tables)
from launchlens.config import settings
from launchlens.db import Base

target_metadata = Base.metadata
POSTGIS_TABLES = {"spatial_ref_sys", "layer", "topology"}


def include_object(obj, name, type_, reflected, compare_to):
    if type_ == "table" and (name in POSTGIS_TABLES or obj.schema == settings.LANGGRAPH_SCHEMA):
        return False
    return True


def do_run(connection):
    context.configure(connection=connection, target_metadata=target_metadata,
                      include_object=include_object, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def run_online():
    engine = create_async_engine(settings.DATABASE_URL)
    async with engine.connect() as conn:
        await conn.run_sync(do_run)
    await engine.dispose()


if context.is_offline_mode():
    context.configure(url=settings.DATABASE_URL, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    asyncio.run(run_online())
