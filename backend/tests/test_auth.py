"""Authentication: register, login, me, logout, CSRF. Email verification is now
handled by Firebase (see test_firebase_auth.py); the legacy token flow is gone."""
from __future__ import annotations

from .conftest import csrf, login, register


def test_register_requires_password_length(client):
    r = client.post("/api/auth/register", json={"email": "a@b.com", "password": "short"})
    assert r.status_code == 422


def test_register_login_me_roundtrip(client):
    r = register(client, "alice@example.com")
    assert r.status_code == 201, r.text
    assert r.json()["email"] == "alice@example.com"

    li = login(client, "alice@example.com")
    assert li.status_code == 200, li.text
    assert li.json()["email"] == "alice@example.com"

    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == "alice@example.com"


def test_session_cookie_is_httponly(client):
    register(client, "bob@example.com")
    li = login(client, "bob@example.com")
    setcookie = li.headers.get("set-cookie", "")
    # At least one cookie is the HttpOnly session cookie.
    assert "httponly" in setcookie.lower()


def test_login_wrong_password_is_uniform(client):
    register(client, "carol@example.com")
    wrong = client.post("/api/auth/login", json={"email": "carol@example.com", "password": "nope-nope-nope"})
    missing = client.post("/api/auth/login", json={"email": "ghost@example.com", "password": "nope-nope-nope"})
    assert wrong.status_code == missing.status_code == 401
    assert wrong.json()["detail"] == missing.json()["detail"]


def test_register_duplicate_email_conflict(client):
    assert register(client, "dup@example.com").status_code == 201
    again = register(client, "dup@example.com")
    assert again.status_code == 409


def test_email_normalized_for_login(client):
    register(client, "MixedCase@Example.com")
    li = login(client, "mixedcase@example.com")
    assert li.status_code == 200


def test_logout_revokes_session(client):
    register(client, "logout@example.com")
    login(client, "logout@example.com")
    assert client.get("/api/auth/me").status_code == 200

    out = client.post("/api/auth/logout", headers=csrf(client))
    assert out.status_code == 200

    # After logout the session cookie is cleared and /me is unauthenticated.
    assert client.get("/api/auth/me").status_code == 401


def test_bootstrap_requires_auth(client):
    assert client.get("/api/bootstrap").status_code == 401


def test_mutating_request_without_csrf_is_rejected(client):
    register(client, "csrf@example.com")
    login(client, "csrf@example.com")
    # No X-CSRF-Token header on a POST → must be rejected (403).
    r = client.post("/api/transactions", json={"id": "tx-1", "month": "2026-01", "kind": "expense", "amountMinor": 100})
    assert r.status_code == 403
