"""Chatbot test harness.

Reuses the exact fixtures/harness the application tests already rely on
(`backend/tests/conftest.py`): an in-memory SQLite database created from the
shared `Base.metadata`, email capture, and a `TestClient` bound to the real app
with the chatbot routes mounted. `pytest.ini` puts `backend` on `pythonpath`, so
`tests.conftest` is importable here; importing it also re-registers its autouse
`_db` fixture for this directory's tests.

Unit tests use a mock provider (see `tests/_mock.py`) and never require a live
LLM. Live-provider tests are separate and opt-in (marked `live`).
"""
from __future__ import annotations

# Re-export the shared fixtures so they apply to chatbot tests in this dir.
from tests.conftest import (  # noqa: F401
    TOKEN_RE,
    _db,
    client,
    csrf,
    db_session,
    login,
    register,
    sent_mail,
)
