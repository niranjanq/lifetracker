"""Pytest harness.

Runs the real FastAPI app against an in-memory SQLite database (portable, no
Docker needed) with rate limiting disabled and email capture monkey-patched.
Production still targets PostgreSQL via DATABASE_URL; these tests exercise the
same models, migration-agnostic schema, auth logic and ownership rules.
"""
from __future__ import annotations

import os

# Must be set BEFORE importing the app so cached settings pick them up.
os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
os.environ["RATELIMIT_ENABLED"] = "false"
os.environ["ENV"] = "test"
os.environ["SECRET_KEY"] = "test-secret-key-please-ignore-0123456789abcdef"
os.environ["ALLOW_LOGIN_UNVERIFIED"] = "true"

# Keep the suite hermetic: config.py loads backend/.env by absolute path, so a
# developer's real FIREBASE_PROJECT_ID (and an ambient Admin credential / ADC)
# would otherwise leak in and make auth tests hit live Firebase. Blank them so
# is_configured() is False unless a test explicitly monkey-patches it.
os.environ["FIREBASE_PROJECT_ID"] = ""
os.environ["FIREBASE_CREDENTIALS_PATH"] = ""

import re  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.core import mail  # noqa: E402
from app.core.db import Base, get_db  # noqa: E402
from app.core.rate_limit import limiter  # noqa: E402
import app.models  # noqa: E402,F401
from app.main import app  # noqa: E402

# Belt-and-braces: never throttle during tests regardless of env parsing.
limiter.enabled = False

engine = create_engine(
    "sqlite+pysqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@pytest.fixture(autouse=True)
def _db():
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    yield
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def sent_mail(monkeypatch):
    """Capture outgoing email instead of hitting a provider."""
    out: list[dict] = []

    def fake_send(to, subject, text, html=None):
        out.append({"to": to, "subject": subject, "body": text, "html": html})

    monkeypatch.setattr(mail, "send_email", fake_send)
    return out


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def db_session():
    """Direct DB access for tests that must manipulate rows (expiry, etc.)."""
    db = TestingSession()
    try:
        yield db
    finally:
        db.close()


# --------------------------------------------------------------------------- #
# helpers shared across test modules
# --------------------------------------------------------------------------- #
TOKEN_RE = re.compile(r"[?&]token=([\w\-]+)")


def csrf(client: TestClient) -> dict:
    token = client.cookies.get("plt_csrf")
    return {"X-CSRF-Token": token} if token else {}


def register(client: TestClient, email: str, password: str = "correct horse battery"):
    return client.post("/api/auth/register", json={"email": email, "password": password, "displayName": "T"})


def login(client: TestClient, email: str, password: str = "correct horse battery"):
    return client.post("/api/auth/login", json={"email": email, "password": password})
