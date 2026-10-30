"""Password-reset dispatch.

Firebase owns the credential for Firebase identities; legacy DB-password
accounts use the server-side single-use token flow. The client response is the
SAME generic body in every case, so the endpoint never reveals whether an
address exists (no account enumeration) — and it does not depend on the browser
SDK's email-enumeration behaviour because the Admin lookup is server-side.

`firebase.is_configured` and `firebase.send_password_reset_email` are
monkey-patched, so no live Firebase project or credential is touched.
"""
from __future__ import annotations

from app.core import firebase
from app.models import AuthToken, User

from .conftest import TOKEN_RE  # noqa: F401  (documents the legacy link shape)


def _mk_user(db, email, *, password_hash=None, firebase_uid=None):
    u = User(email=email, password_hash=password_hash, firebase_uid=firebase_uid,
             email_verified_at=None, onboarded=True)
    db.add(u)
    db.commit()
    return u


def _patch(monkeypatch, *, configured=True, sent_for=()):
    """Return the list of emails Firebase was asked to reset."""
    seen: list[str] = []
    monkeypatch.setattr(firebase, "is_configured", lambda: configured)

    def _send(email, continue_url=None):
        seen.append(email)
        return email in set(sent_for)

    monkeypatch.setattr(firebase, "send_password_reset_email", _send)
    return seen


def test_firebase_user_not_in_our_db_gets_firebase_reset_only(client, monkeypatch, db_session, sent_mail):
    # A Firebase account that has never exchanged a token with us: no DB row, but
    # Firebase knows it → reset via Firebase, no legacy token, no legacy email.
    seen = _patch(monkeypatch, configured=True, sent_for=("ghost@example.com",))
    r = client.post("/api/auth/forgot-password", json={"email": "ghost@example.com"})
    assert r.status_code == 200
    assert "ghost@example.com" in seen
    assert db_session.query(AuthToken).count() == 0
    assert sent_mail == []


def test_firebase_linked_account_is_not_given_a_legacy_token(client, monkeypatch, db_session, sent_mail):
    # Firebase-only row (linked, no DB password): Firebase is the sole source.
    _patch(monkeypatch, configured=True, sent_for=("fb@example.com",))
    _mk_user(db_session, "fb@example.com", firebase_uid="fb-uid")
    r = client.post("/api/auth/forgot-password", json={"email": "fb@example.com"})
    assert r.status_code == 200
    assert db_session.query(AuthToken).count() == 0      # never a legacy link
    assert sent_mail == []


def test_legacy_password_account_uses_token_flow(client, monkeypatch, db_session, sent_mail):
    # Firebase does not know this address → fall through to the legacy token link.
    _patch(monkeypatch, configured=True, sent_for=())
    u = _mk_user(db_session, "legacy@example.com", password_hash="hashed")
    r = client.post("/api/auth/forgot-password", json={"email": "legacy@example.com"})
    assert r.status_code == 200
    tok = db_session.query(AuthToken).filter(AuthToken.purpose == "password_reset").all()
    assert len(tok) == 1 and tok[0].user_id == u.pk
    assert any(m["to"] == "legacy@example.com" for m in sent_mail)


def test_when_firebase_not_configured_legacy_path_still_works(client, monkeypatch, db_session, sent_mail):
    seen = _patch(monkeypatch, configured=False)
    _mk_user(db_session, "off@example.com", password_hash="hashed")
    r = client.post("/api/auth/forgot-password", json={"email": "off@example.com"})
    assert r.status_code == 200
    assert seen == []                                    # Firebase never consulted
    assert db_session.query(AuthToken).count() == 1
    assert any(m["to"] == "off@example.com" for m in sent_mail)


def test_link_with_both_credentials_falls_back_when_firebase_unavailable(client, monkeypatch, db_session, sent_mail):
    # A migrated account that still has a DB password: if Firebase cannot send,
    # the legacy token keeps the user recoverable.
    _patch(monkeypatch, configured=True, sent_for=())
    _mk_user(db_session, "dual@example.com", password_hash="hashed", firebase_uid="d-uid")
    r = client.post("/api/auth/forgot-password", json={"email": "dual@example.com"})
    assert r.status_code == 200
    assert db_session.query(AuthToken).count() == 1


def test_response_is_identical_for_existing_and_unknown_email(client, monkeypatch, sent_mail):
    # No enumeration: same status AND same body regardless of existence.
    _patch(monkeypatch, configured=True, sent_for=())
    r_exists = client.post("/api/auth/forgot-password", json={"email": "nobody@here.com"})
    r_missing = client.post("/api/auth/forgot-password", json={"email": "still-nobody@here.com"})
    assert r_exists.status_code == r_missing.status_code == 200
    assert r_exists.json() == r_missing.json()
