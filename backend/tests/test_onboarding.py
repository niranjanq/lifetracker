"""Onboarding completion persistence + guards (regression).

Confirms the wizard's final action durably records completion on the user row,
survives a reload and a brand-new session, and that the endpoints stay behind
the session cookie + CSRF double-submit — nothing here weakens auth or marks
onboarding complete without a real write.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.models import User

from .conftest import csrf, login, register


def _prefs(**over):
    body = {
        "displayName": "T", "currency": "INR", "timeZone": "Asia/Kolkata",
        "budgetPeriod": "calendar", "theme": "dark", "reducedMotion": False,
        "remindersEnabled": False, "onboarded": True,
    }
    body.update(over)
    return body


def test_new_user_defaults_to_not_onboarded(client):
    register(client, "ob1@example.com")
    login(client, "ob1@example.com")
    assert client.get("/api/bootstrap").json()["preferences"]["onboarded"] is False


def test_onboarding_persists_and_survives_reload(client):
    register(client, "ob2@example.com")
    login(client, "ob2@example.com")
    r = client.put("/api/settings/preferences", json=_prefs(), headers=csrf(client))
    assert r.status_code == 200, r.text
    # A subsequent bootstrap (app reload) still reports completion.
    assert client.get("/api/bootstrap").json()["preferences"]["onboarded"] is True


def test_onboarding_survives_a_new_session(client):
    register(client, "ob3@example.com")
    login(client, "ob3@example.com")
    client.put("/api/settings/preferences", json=_prefs(), headers=csrf(client))

    c2 = TestClient(app)
    login(c2, "ob3@example.com")
    # Fresh login sees completion => it lives on the user row, not in memory.
    assert c2.get("/api/bootstrap").json()["preferences"]["onboarded"] is True


def test_onboarding_updates_the_user_column(client, db_session):
    register(client, "ob4@example.com")
    login(client, "ob4@example.com")
    client.put("/api/settings/preferences", json=_prefs(), headers=csrf(client))
    u = db_session.query(User).filter(User.email == "ob4@example.com").one()
    assert u.onboarded is True


def test_onboarding_with_collection_writes_keeps_completion(client):
    # Mirrors finish(): set onboarded, then write records; completion must hold.
    register(client, "ob6@example.com")
    login(client, "ob6@example.com")
    client.put("/api/settings/preferences", json=_prefs(), headers=csrf(client))
    tx = {"id": "tx-ob", "month": "2026-01", "kind": "expense", "amountMinor": 100, "categoryId": "cat-food"}
    assert client.post("/api/transactions", json=tx, headers=csrf(client)).status_code == 200
    b = client.get("/api/bootstrap").json()
    assert b["preferences"]["onboarded"] is True
    assert "tx-ob" in {rec["id"] for rec in b["transactions"]}


def test_bootstrap_requires_session():
    assert TestClient(app).get("/api/bootstrap").status_code == 401


def test_settings_put_requires_csrf(client):
    register(client, "ob5@example.com")
    login(client, "ob5@example.com")
    # Mutating verb without the CSRF header must be rejected (guard intact).
    assert client.put("/api/settings/preferences", json=_prefs()).status_code == 403
