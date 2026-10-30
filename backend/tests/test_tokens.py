"""Reset/verification token expiry, single-use enforcement, session expiry,
and session revocation on password change/reset.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from app.main import app
from app.models import AuthToken, Session, User

from .conftest import TOKEN_RE, csrf, login, register


def _backdate(obj, attr, days=1):
    setattr(obj, attr, datetime.utcnow() - timedelta(days=days))


def _reset_token(db, user_email):
    uid = db.query(User).filter(User.email == user_email).one().pk
    return db.query(AuthToken).filter(
        AuthToken.user_id == uid, AuthToken.purpose == "password_reset", AuthToken.used_at.is_(None)
    ).order_by(AuthToken.created_at.desc()).first()


def test_forgot_password_is_uniform(client, sent_mail):
    register(client, "exists@example.com")
    r_existing = client.post("/api/auth/forgot-password", json={"email": "exists@example.com"})
    r_missing = client.post("/api/auth/forgot-password", json={"email": "nobody@example.com"})
    assert r_existing.status_code == r_missing.status_code == 200
    assert r_existing.json() == r_missing.json()


def test_reset_password_flow_single_use(client, sent_mail, db_session):
    register(client, "reset@example.com")
    login(client, "reset@example.com")
    assert client.get("/api/auth/me").status_code == 200

    client.post("/api/auth/forgot-password", json={"email": "reset@example.com"})
    token = TOKEN_RE.search(sent_mail[-1]["body"]).group(1)

    newp = "brand-new-password-123"
    r = client.post("/api/auth/reset-password", json={"token": token, "password": newp})
    assert r.status_code == 200, r.text

    # Old session is gone after reset (point 9).
    assert client.get("/api/auth/me").status_code == 401

    # Single-use: replay rejected.
    replay = client.post("/api/auth/reset-password", json={"token": token, "password": newp})
    assert replay.status_code == 400

    # New password works, old does not.
    assert login(client, "reset@example.com", newp).status_code == 200
    assert client.post("/api/auth/login", json={"email": "reset@example.com", "password": "correct horse battery"}).status_code == 401


def test_reset_token_expiry(client, sent_mail, db_session):
    register(client, "expired@example.com")
    client.post("/api/auth/forgot-password", json={"email": "expired@example.com"})
    token = TOKEN_RE.search(sent_mail[-1]["body"]).group(1)
    row = _reset_token(db_session, "expired@example.com")
    _backdate(row, "expires_at")
    db_session.commit()
    r = client.post("/api/auth/reset-password", json={"token": token, "password": "another-password-9"})
    assert r.status_code == 400
    assert "expired" in r.json()["detail"].lower()


def test_session_expiry(client, db_session):
    register(client, "sess@example.com")
    login(client, "sess@example.com")
    assert client.get("/api/auth/me").status_code == 200

    uid = db_session.query(User).filter(User.email == "sess@example.com").one().pk
    sess = db_session.query(Session).filter(Session.user_id == uid).order_by(Session.created_at.desc()).first()
    _backdate(sess, "expires_at")
    db_session.commit()

    assert client.get("/api/auth/me").status_code == 401


def test_change_password_reauth_and_revokes_sessions(client, db_session):
    register(client, "cp@example.com")
    login(client, "cp@example.com")

    # A second independent session for the same user.
    other = TestClient(app)
    other.post("/api/auth/login", json={"email": "cp@example.com", "password": "correct horse battery"})
    assert other.get("/api/auth/me").status_code == 200

    # Wrong current password → rejected.
    bad = client.post("/api/auth/change-password",
                      json={"currentPassword": "wrong wrong wrong", "newPassword": "new-password-42"},
                      headers=csrf(client))
    assert bad.status_code == 403

    # Correct change.
    ok = client.post("/api/auth/change-password",
                     json={"currentPassword": "correct horse battery", "newPassword": "new-password-42"},
                     headers=csrf(client))
    assert ok.status_code == 200, ok.text

    # Both the acting session and the other session are revoked (point 9).
    assert client.get("/api/auth/me").status_code == 401
    assert other.get("/api/auth/me").status_code == 401

    # New password now logs in; old does not.
    assert login(client, "cp@example.com", "new-password-42").status_code == 200


def test_new_reset_token_supersedes_old(client, sent_mail, db_session):
    register(client, "sup@example.com")
    client.post("/api/auth/forgot-password", json={"email": "sup@example.com"})
    first = TOKEN_RE.search(sent_mail[-1]["body"]).group(1)
    client.post("/api/auth/forgot-password", json={"email": "sup@example.com"})
    second = TOKEN_RE.search(sent_mail[-1]["body"]).group(1)

    # Using the first (now superseded) token must fail.
    assert client.post("/api/auth/reset-password", json={"token": first, "password": "p-1234567890"}).status_code == 400
    # The latest token works.
    assert client.post("/api/auth/reset-password", json={"token": second, "password": "p-1234567890"}).status_code == 200
