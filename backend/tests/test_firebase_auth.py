"""Firebase identity → own-session integration.

`app.core.firebase.verify_firebase_token` is monkey-patched, so these tests
exercise the endpoint's security decisions (valid/invalid/revoked tokens, the
verification gate, safe account linking, JIT provisioning, session + CSRF and
per-user data isolation) WITHOUT a live Firebase project. Real token signature
verification against project `lifetracker-0703` is NOT covered here.
"""
from __future__ import annotations

import pytest

from app.core import firebase
from app.models import User

from .conftest import csrf, login, register


def _fake_verify(monkeypatch, **overrides):
    """Patch verify_firebase_token to return a decoded assertion for any token."""
    base = {
        "uid": "uid-123",
        "email": "fire@example.com",
        "email_verified": True,
        "provider": "password",
        "name": "Fire User",
    }
    base.update(overrides)

    def _verify(id_token: str) -> dict:
        return dict(base)

    monkeypatch.setattr(firebase, "verify_firebase_token", _verify)
    return base


def _reject(monkeypatch):
    def _verify(id_token: str) -> dict:
        raise firebase.FirebaseAuthError("bad")

    monkeypatch.setattr(firebase, "verify_firebase_token", _verify)


def _post_firebase(client, token="fake-id-token-0123456789abcdef"):
    return client.post("/api/auth/firebase", json={"idToken": token})


def test_valid_verified_token_creates_session(client, monkeypatch):
    _fake_verify(monkeypatch, uid="u-new", email="new@example.com", name="New User")
    r = _post_firebase(client)
    assert r.status_code == 200, r.text
    assert r.json()["email"] == "new@example.com"
    assert r.json()["emailVerified"] is True
    assert client.get("/api/auth/me").status_code == 200
    # Session cookie is HttpOnly.
    assert "httponly" in r.headers.get("set-cookie", "").lower()


def test_jit_provision_creates_passwordless_user(client, monkeypatch, db_session):
    _fake_verify(monkeypatch, uid="u-jit", email="jit@example.com", name="Jit")
    assert _post_firebase(client).status_code == 200
    user = db_session.query(User).filter(User.email == "jit@example.com").one()
    assert user.firebase_uid == "u-jit"
    assert user.password_hash is None          # identity lives in Firebase
    assert user.email_verified_at is not None


def test_invalid_token_is_401(client, monkeypatch):
    _reject(monkeypatch)
    r = _post_firebase(client)
    assert r.status_code == 401
    assert client.get("/api/auth/me").status_code == 401


def test_short_token_rejected_before_verify(client, monkeypatch):
    called = {"n": 0}
    def _verify(id_token):
        called["n"] += 1
        return {"uid": "x", "email": "a@b.com", "email_verified": True}
    monkeypatch.setattr(firebase, "verify_firebase_token", _verify)
    r = client.post("/api/auth/firebase", json={"idToken": "tiny"})
    assert r.status_code == 422          # schema min_length guards the round-trip
    assert called["n"] == 0


def test_unverified_email_is_gated_and_gets_no_session(client, monkeypatch):
    _fake_verify(monkeypatch, uid="u-unver", email="unver@example.com", email_verified=False)
    r = _post_firebase(client)
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "email_not_verified"
    assert client.get("/api/auth/me").status_code == 401   # no session minted


def test_google_provider_signin_works(client, monkeypatch, db_session):
    _fake_verify(monkeypatch, uid="g-1", email="g@example.com", provider="google.com", name="G")
    assert _post_firebase(client).status_code == 200
    user = db_session.query(User).filter(User.email == "g@example.com").one()
    assert user.firebase_uid == "g-1"


def test_same_uid_relogs_into_same_user_no_duplicate(client, monkeypatch, db_session):
    _fake_verify(monkeypatch, uid="u-same", email="same@example.com")
    first = _post_firebase(client)
    assert first.status_code == 200
    pk = db_session.query(User).filter(User.firebase_uid == "u-same").one().pk
    # A fresh client logs in again with the same uid.
    from fastapi.testclient import TestClient
    from app.main import app
    c2 = TestClient(app)
    assert c2.post("/api/auth/firebase", json={"idToken": "x" * 40}).status_code == 200
    users = db_session.query(User).filter(User.firebase_uid == "u-same").all()
    assert len(users) == 1
    assert users[0].pk == pk


def test_verified_email_links_to_existing_account_preserving_id(client, monkeypatch, db_session):
    # Legacy password account exists, not yet verified in our DB, no firebase_uid.
    register(client, "legacy@example.com")
    pk = db_session.query(User).filter(User.email == "legacy@example.com").one().pk
    assert db_session.query(User).filter(User.firebase_uid == "u-leg").count() == 0

    _fake_verify(monkeypatch, uid="u-leg", email="legacy@example.com", email_verified=True)
    assert _post_firebase(client).status_code == 200

    user = db_session.query(User).filter(User.email == "legacy@example.com").one()
    assert user.pk == pk                          # existing id preserved
    assert user.firebase_uid == "u-leg"           # linked


def test_unverified_email_never_links_existing_account(client, monkeypatch, db_session):
    register(client, "takeover@example.com")
    before = db_session.query(User).filter(User.email == "takeover@example.com").one()
    _fake_verify(monkeypatch, uid="attacker", email="takeover@example.com", email_verified=False)
    r = _post_firebase(client)
    assert r.status_code == 403
    after = db_session.query(User).filter(User.email == "takeover@example.com").one()
    assert after.firebase_uid is None             # not linked on unverified email


def test_uid_already_bound_to_other_account_is_not_hijacked(client, monkeypatch, db_session):
    # A user already linked to uid-A now presents uid-B with the same email.
    _fake_verify(monkeypatch, uid="uid-A", email="dual@example.com")
    assert _post_firebase(client).status_code == 200
    _fake_verify(monkeypatch, uid="uid-B", email="dual@example.com")
    r = _post_firebase(client)
    assert r.status_code == 409


def test_session_enforces_csrf_after_firebase_login(client, monkeypatch):
    _fake_verify(monkeypatch, uid="c-1", email="csrf@example.com")
    assert _post_firebase(client).status_code == 200
    # Mutating without the CSRF header is rejected...
    bad = client.post("/api/transactions",
                      json={"id": "tx-1", "month": "2026-01", "kind": "expense", "amountMinor": 100})
    assert bad.status_code == 403
    # ...and accepted with it.
    good = client.post("/api/transactions",
                       json={"id": "tx-1", "month": "2026-01", "kind": "expense", "amountMinor": 100},
                       headers=csrf(client))
    assert good.status_code in (200, 201)


def test_two_firebase_users_are_isolated(client, monkeypatch):
    def verify_a(token):
        return {"uid": "iso-A", "email": "a@iso.com", "email_verified": True, "provider": "password", "name": None}
    monkeypatch.setattr(firebase, "verify_firebase_token", verify_a)
    from fastapi.testclient import TestClient
    from app.main import app
    ca = TestClient(app)
    assert ca.post("/api/auth/firebase", json={"idToken": "x" * 40}).status_code == 200
    ca.post("/api/transactions",
            json={"id": "tx-a", "month": "2026-01", "kind": "expense", "amountMinor": 500},
            headers=csrf(ca))

    monkeypatch.setattr(
        firebase, "verify_firebase_token",
        lambda token: {"uid": "iso-B", "email": "b@iso.com", "email_verified": True, "provider": "password", "name": None},
    )
    cb = TestClient(app)
    assert cb.post("/api/auth/firebase", json={"idToken": "x" * 40}).status_code == 200
    seen = {rec["id"] for rec in cb.get("/api/bootstrap").json()["transactions"]}
    assert "tx-a" not in seen                     # B cannot see A's data


# --------------------------------------------------------------------------- #
# provider allow-list
# --------------------------------------------------------------------------- #
def test_unsupported_provider_is_rejected_no_user_created(client, monkeypatch, db_session):
    _fake_verify(monkeypatch, uid="ph-1", email="phone@example.com", provider="phone")
    r = _post_firebase(client)
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "unsupported_provider"
    assert client.get("/api/auth/me").status_code == 401          # no session
    assert db_session.query(User).filter(User.email == "phone@example.com").count() == 0


def test_unsupported_provider_cannot_link_existing_email(client, monkeypatch, db_session):
    # A verified email from an unvetted provider must NOT link a legacy account:
    # we only trust mailbox ownership from providers on the allow-list.
    register(client, "app@example.com")
    _fake_verify(monkeypatch, uid="apple-1", email="app@example.com",
                 provider="apple.com", email_verified=True)
    r = _post_firebase(client)
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "unsupported_provider"
    user = db_session.query(User).filter(User.email == "app@example.com").one()
    assert user.firebase_uid is None                # never linked by apple.com


def test_allowed_providers_password_and_google(client, monkeypatch, db_session):
    _fake_verify(monkeypatch, uid="pw-1", email="pwok@example.com", provider="password")
    assert _post_firebase(client).status_code == 200
    _fake_verify(monkeypatch, uid="gg-1", email="ggok@example.com", provider="google.com")
    assert _post_firebase(client).status_code == 200


# --------------------------------------------------------------------------- #
# legacy /register retired in production
# --------------------------------------------------------------------------- #
def test_legacy_register_blocked_in_production(client, monkeypatch):
    import app.api.auth as auth_mod
    monkeypatch.setattr(type(auth_mod.settings), "is_prod",
                        property(lambda self: True), raising=True)
    r = client.post("/api/auth/register",
                    json={"email": "prod@x.com", "password": "correct horse battery", "displayName": "P"})
    assert r.status_code == 410


def test_legacy_register_allowed_outside_production(client, db_session):
    # ENV=test → is_prod False → the migration/test path still works.
    assert register(client, "still@works.com").status_code == 201


# --------------------------------------------------------------------------- #
# linking preserves the existing row's id AND its records
# --------------------------------------------------------------------------- #
def test_linking_preserves_user_id_and_records(client, monkeypatch, db_session):
    register(client, "keep@example.com")
    assert login(client, "keep@example.com").status_code == 200
    post = client.post("/api/transactions",
                       json={"id": "tx-keep", "month": "2026-01", "kind": "expense", "amountMinor": 700},
                       headers=csrf(client))
    assert post.status_code in (200, 201)
    pk = db_session.query(User).filter(User.email == "keep@example.com").one().pk

    # A fresh Firebase password sign-in with the same verified email links the uid
    # to the SAME row; no duplicate user, no data loss.
    _fake_verify(monkeypatch, uid="keep-uid", email="keep@example.com",
                 provider="password", email_verified=True)
    from fastapi.testclient import TestClient
    from app.main import app
    c2 = TestClient(app)
    assert c2.post("/api/auth/firebase", json={"idToken": "x" * 40}).status_code == 200

    user = db_session.query(User).filter(User.email == "keep@example.com").one()
    assert user.pk == pk                             # id preserved
    assert user.firebase_uid == "keep-uid"           # linked
    assert db_session.query(User).filter(User.firebase_uid == "keep-uid").count() == 1
    txs = {rec["id"] for rec in c2.get("/api/bootstrap").json()["transactions"]}
    assert "tx-keep" in txs                          # records preserved
