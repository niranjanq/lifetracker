"""Database engine + session + declarative base.

Portable SQLAlchemy types (String/JSON/DateTime) are used so the same models
and Alembic migration run on PostgreSQL in production and on SQLite during
local/CI testing.
"""
from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings


def _make_engine(url: str):
    kwargs: dict = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        # SQLite: allow use across threads (FastAPI TestClient) + single file.
        kwargs["connect_args"] = {"check_same_thread": False}
        from sqlalchemy.pool import StaticPool
        if ":memory:" in url:
            kwargs["poolclass"] = StaticPool
    return create_engine(url, **kwargs)


engine = _make_engine(settings.DATABASE_URL)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
