"""Database engine + session + declarative base."""

from __future__ import annotations

import socket

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings


def _make_engine(url: str):
    kwargs: dict = {"pool_pre_ping": True}

    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
        from sqlalchemy.pool import StaticPool

        if ":memory:" in url:
            kwargs["poolclass"] = StaticPool

    elif url.startswith("postgresql"):
        if settings.DB_FORCE_IPV4:
            parsed = make_url(url)
            host = parsed.host
            port = parsed.port or 5432

            if not host:
                raise RuntimeError("Database hostname is missing")

            addresses = socket.getaddrinfo(
                host, port, socket.AF_INET, socket.SOCK_STREAM
            )

            if not addresses:
                raise RuntimeError("No IPv4 address found for database host")

            kwargs["connect_args"] = {
                "hostaddr": addresses[0][4][0]
            }

    return create_engine(url, **kwargs)


engine = _make_engine(settings.DATABASE_URL)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()