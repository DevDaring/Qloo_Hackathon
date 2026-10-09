"""Async SQLAlchemy engine and session helpers.

Transactions are short: no provider call is ever made while a session holds a
transaction open (see services/jobs.py and the provider adapters).
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import settings


class Base(DeclarativeBase):
    # Fetch server-generated values (created_at/updated_at defaults and
    # onupdate) with RETURNING, so rows can be serialised after a commit
    # without lazy IO.
    __mapper_args__ = {"eager_defaults": True}


engine = create_async_engine(
    settings.DATABASE_URL,
    pool_size=10,
    max_overflow=10,
    pool_pre_ping=True,
    connect_args={"server_settings": {"application_name": "launchlens", "timezone": "UTC"}},
)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """A unit of work: commit on success, roll back on error."""
    async with SessionLocal() as session:
        try:
            yield session
            await session.commit()
        except BaseException:
            await session.rollback()
            raise
