"""Firebase Admin verification error classification (regression).

Bug this locks down: every Admin-SDK failure — including a missing service
credential or a certificate-fetch/network error — used to be collapsed into one
`FirebaseAuthError("Invalid or expired sign-in token.")` (401). That mislabeled a
SERVER-side configuration problem as a bad client token and hid the real cause.

These tests assert the classes stay distinct, that a missing Admin credential is
a loud configuration error, and that the endpoint maps each to the right status.
No live Firebase project is contacted: the Admin SDK call and the ADC probe are
monkey-patched.
"""
from __future__ import annotations

import google.auth
import firebase_admin.auth as fb_auth
import pytest
from google.auth.exceptions import DefaultCredentialsError

from app.core import firebase


def _mkerr(cls):
    """Instantiate a firebase_admin verification exception regardless of whether
    it takes (message), (message, cause), or no args."""
    for args in (("detail", "cause"), ("detail",), ()):
        try:
            return cls(*args)
        except TypeError:
            continue
    raise AssertionError(f"cannot construct {cls!r}")


# --------------------------------------------------------------------------- #
# verify_firebase_token: classify the Admin SDK exception, never the token
# --------------------------------------------------------------------------- #
def _raise_from_verify(monkeypatch, exc):
    monkeypatch.setattr(firebase, "_initialized", True)  # skip _ensure_app

    def fake_verify(token, app=None, check_revoked=False):
        raise exc

    monkeypatch.setattr(fb_auth, "verify_id_token", fake_verify)


def test_expired_token_is_auth_error(monkeypatch):
    _raise_from_verify(monkeypatch, _mkerr(fb_auth.ExpiredIdTokenError))
    with pytest.raises(firebase.FirebaseAuthError):
        firebase.verify_firebase_token("t" * 40)


def test_revoked_token_is_auth_error(monkeypatch):
    _raise_from_verify(monkeypatch, _mkerr(fb_auth.RevokedIdTokenError))
    with pytest.raises(firebase.FirebaseAuthError):
        firebase.verify_firebase_token("t" * 40)


def test_invalid_token_is_auth_error(monkeypatch):
    _raise_from_verify(monkeypatch, _mkerr(fb_auth.InvalidIdTokenError))
    with pytest.raises(firebase.FirebaseAuthError):
        firebase.verify_firebase_token("t" * 40)


def test_certificate_fetch_is_transient_not_invalid(monkeypatch):
    # A cert-fetch failure is server-side; it must NOT become "invalid token".
    _raise_from_verify(monkeypatch, _mkerr(fb_auth.CertificateFetchError))
    with pytest.raises(firebase.FirebaseTransientError):
        firebase.verify_firebase_token("t" * 40)


def test_unexpected_transport_error_is_transient_not_invalid(monkeypatch):
    # Regression for the reported symptom: a credential/network exception must be
    # treated as a server-side problem, never as an expired/invalid client token.
    _raise_from_verify(monkeypatch, ConnectionResetError("transport"))
    with pytest.raises(firebase.FirebaseTransientError):
        firebase.verify_firebase_token("t" * 40)


# --------------------------------------------------------------------------- #
# _ensure_app: a missing Admin credential is a loud configuration error (503)
# --------------------------------------------------------------------------- #
def test_missing_adc_raises_not_configured(monkeypatch):
    monkeypatch.setattr(firebase, "_initialized", False)
    monkeypatch.setattr(firebase.settings, "FIREBASE_PROJECT_ID", "lifetracker-0703")
    monkeypatch.setattr(firebase.settings, "FIREBASE_CREDENTIALS_PATH", "")

    def boom(*args, **kwargs):
        raise DefaultCredentialsError("Could not find the default credentials")

    monkeypatch.setattr(google.auth, "default", boom)
    with pytest.raises(firebase.FirebaseNotConfiguredError):
        firebase.verify_firebase_token("t" * 40)


def test_bad_service_account_path_raises_not_configured(monkeypatch):
    monkeypatch.setattr(firebase, "_initialized", False)
    monkeypatch.setattr(firebase.settings, "FIREBASE_PROJECT_ID", "lifetracker-0703")
    monkeypatch.setattr(firebase.settings, "FIREBASE_CREDENTIALS_PATH", "/nope/missing.json")
    with pytest.raises(firebase.FirebaseNotConfiguredError):
        firebase.verify_firebase_token("t" * 40)


# --------------------------------------------------------------------------- #
# endpoint: the classes map to distinguishable HTTP outcomes (401 vs 503)
# --------------------------------------------------------------------------- #
def _patch_verify(client, monkeypatch, exc):
    def boom(token):
        raise exc

    monkeypatch.setattr(firebase, "verify_firebase_token", boom)
    return client.post("/api/auth/firebase", json={"idToken": "x" * 40})


def test_endpoint_transient_error_returns_503(client, monkeypatch):
    r = _patch_verify(client, monkeypatch, firebase.FirebaseTransientError("cert fetch failed"))
    assert r.status_code == 503


def test_endpoint_not_configured_returns_503(client, monkeypatch):
    r = _patch_verify(client, monkeypatch, firebase.FirebaseNotConfiguredError("no credential"))
    assert r.status_code == 503


def test_endpoint_invalid_token_still_returns_401(client, monkeypatch):
    r = _patch_verify(
        client, monkeypatch,
        firebase.FirebaseAuthError("Invalid or expired sign-in token."),
    )
    assert r.status_code == 401
