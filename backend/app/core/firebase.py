"""Firebase Admin integration.

The browser obtains a Firebase ID token (email/password or Google). This module
verifies that token server-side with the official Admin SDK so the backend never
trusts identity or verification claims the client could have forged. Only the
result of `verify_id_token` — a genuinely signed, unexpired, non-revoked Firebase
assertion — drives account lookup, linking and session creation.

The Admin SDK is imported lazily (inside functions) so importing this module —
and therefore the whole app — never requires the optional dependency or a live
Firebase project. The test-suite monkey-patches `verify_firebase_token` directly.

Error reporting is deliberately precise: a genuine invalid/expired/revoked token
is a client error (`FirebaseAuthError` → 401), while a server-side problem — a
missing Admin credential, a certificate-fetch failure or a transient network
error — is `FirebaseNotConfiguredError`/`FirebaseTransientError` → 503. Collapsing
the two behind one generic message hides real misconfiguration, so they are never
merged here.
"""
from __future__ import annotations

import logging

from .config import settings

logger = logging.getLogger("plt.firebase")


class FirebaseAuthError(Exception):
    """Token is invalid, expired or revoked — always a 401 for the caller."""


class FirebaseNotConfiguredError(RuntimeError):
    """The backend has no Firebase project or usable Admin credential — a 503."""


class FirebaseTransientError(RuntimeError):
    """Verification could not be completed for a server-side reason (certificate
    fetch failure, transport/permission error). A 503, NOT a client token error."""


_initialized = False


def _log_error(context: str, exc: BaseException) -> None:
    """Log the exception class + a short, sanitized detail.

    Never logs the token itself, passwords, cookies or credentials. Firebase's
    verification exceptions describe the failure (project / audience / expiry /
    certificates), not the token value, so the truncated message is safe.
    """
    logger.error("Firebase %s failed: %s: %s",
                 context, type(exc).__name__, str(exc)[:200])


def is_configured() -> bool:
    return bool(settings.FIREBASE_PROJECT_ID.strip())


def _ensure_app() -> None:
    """Initialise the default Firebase app once, on first real verification.

    The Admin credential is resolved EAGERLY here. `firebase_admin.initialize_app
    (None, …)` happily creates an app even with no credential available, and the
    failure only surfaces later (during certificate fetch) as a GoogleAuth error —
    which previously got mis-reported to the user as an "invalid token". Loading
    the credential now turns that into an unambiguous 503 configuration error.
    """
    global _initialized
    if _initialized:
        return
    if not is_configured():
        raise FirebaseNotConfiguredError("Firebase authentication is not configured on the server.")

    import firebase_admin
    from firebase_admin import credentials

    options = {"projectId": settings.FIREBASE_PROJECT_ID.strip()}
    path = settings.FIREBASE_CREDENTIALS_PATH.strip()
    try:
        if path:
            cred = credentials.Certificate(path)
        else:
            # Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS,
            # `gcloud auth application-default login`, Workload Identity, etc.).
            # firebase_admin has no ADC credential class and initialize_app(None, …)
            # defers the lookup, so we probe eagerly: google.auth.default() raises
            # DefaultCredentialsError now if none exists, instead of surfacing later
            # as a certificate-fetch failure mis-reported to the user as a bad token.
            import google.auth

            google.auth.default()
            cred = None
    except Exception as exc:  # google.auth DefaultCredentialsError, IOError, ValueError
        _log_error("credential load", exc)
        raise FirebaseNotConfiguredError(
            "Firebase authentication is misconfigured on the server: no Admin SDK "
            "credential is available. Set FIREBASE_CREDENTIALS_PATH to a "
            "service-account JSON, or configure Application Default Credentials."
        ) from exc

    if not firebase_admin._apps:  # pragma: no cover - defensive against double-init
        firebase_admin.initialize_app(cred, options)
    _initialized = True


def verify_firebase_token(id_token: str) -> dict:
    """Verify a Firebase ID token and return the fields the app relies on.

    Raises FirebaseAuthError (→ 401) only for a genuine invalid / expired / revoked
    token, FirebaseNotConfiguredError (→ 503) when the server lacks a project or
    credential, and FirebaseTransientError (→ 503) when verification could not be
    completed for a server-side reason (certificate fetch / transport). The exact
    exception class is logged for diagnosis — never the token.
    """
    _ensure_app()
    from firebase_admin import auth as fb_auth

    try:
        decoded = fb_auth.verify_id_token(id_token, check_revoked=True)
    except fb_auth.ExpiredIdTokenError as exc:
        _log_error("token verify (expired)", exc)
        raise FirebaseAuthError("The sign-in link has expired. Please sign in again.") from exc
    except fb_auth.RevokedIdTokenError as exc:
        _log_error("token verify (revoked)", exc)
        raise FirebaseAuthError("This sign-in has been revoked. Please sign in again.") from exc
    except fb_auth.CertificateFetchError as exc:
        # Server-side: the Admin SDK could not obtain Google's signing certificates.
        _log_error("token verify (certificate fetch)", exc)
        raise FirebaseTransientError(
            "Could not verify the sign-in right now. Please try again shortly."
        ) from exc
    except fb_auth.InvalidIdTokenError as exc:
        # Covers signature/audience/issuer/format problems (Expired/Revoked handled
        # above). Legitimate client token failure → 401.
        _log_error("token verify (invalid)", exc)
        raise FirebaseAuthError("Invalid or expired sign-in token.") from exc
    except Exception as exc:
        # Anything else (revocation-check transport/permission, unexpected library
        # behaviour) is a SERVER-side problem. Never call it an invalid client token.
        _log_error("token verify (unexpected)", exc)
        raise FirebaseTransientError(
            "Could not verify the sign-in right now. Please try again shortly."
        ) from exc

    uid = decoded.get("uid")
    if not uid:
        raise FirebaseAuthError("Sign-in token is missing a subject.")

    provider = (decoded.get("firebase") or {}).get("sign_in_provider")
    return {
        "uid": uid,
        "email": decoded.get("email"),
        # Absent for providers that cannot prove mailbox ownership → treat as
        # unverified so an unproven email can never link an existing account.
        "email_verified": bool(decoded.get("email_verified", False)),
        "provider": provider,
        "name": decoded.get("name"),
    }


def send_password_reset_email(email: str, continue_url: str | None = None) -> bool:
    """Send Firebase's password-reset email for `email` via the Admin SDK.

    This is a SERVER-SIDE lookup, so callers keep a single generic client-facing
    response no matter the project's email-enumeration-protection setting. Returns
    True when Firebase accepted the send for an existing user, and False when no
    Firebase user matches the address (`UserNotFoundError`). Raises
    FirebaseNotConfiguredError if the backend has no project / credential.
    """
    _ensure_app()
    from firebase_admin import auth as fb_auth

    action_link_settings = (
        fb_auth.ActionCodeSettings(url=continue_url) if continue_url else None
    )
    try:
        fb_auth.send_password_reset_email(email, action_link_settings)
        return True
    except fb_auth.UserNotFoundError:
        return False
