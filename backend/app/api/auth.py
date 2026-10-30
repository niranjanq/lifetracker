"""Authentication endpoints: register, firebase login, login, logout, me,
forgot/reset, change-password. Cookie sessions + CSRF + hashed single-use tokens.

Identity (email/password + Google) is issued by Firebase in the browser; this
backend verifies the Firebase ID token and mints its own secure cookie session.
The legacy email-verification token flow has been removed in favour of Firebase.

NOTE: `from __future__ import annotations` is intentionally NOT used in FastAPI
route modules. Lazy string annotations can stop FastAPI from recognising the
special `Request`/`Response` parameters, which makes it embed the Pydantic body
param and reject well-formed flat JSON with "payload: Field required".
"""
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session as DbSession

from ..core import firebase, mail
from ..core.config import settings
from ..core.db import get_db
from ..core.email_templates import reset_email
from ..core.rate_limit import limiter
from ..core.security import (
    expires_in, hash_password, hash_token, new_csrf, new_token, normalize_email,
    password_needs_rehash, utcnow, verify_password,
)
from ..deps import get_current_user, get_session_from_cookie, require_reauth
from ..models import AuthToken, Session, User
from ..schemas import (
    ChangePasswordIn, FirebaseLoginIn, ForgotIn, LoginIn, RegisterIn, ResetIn, UserOut,
)
from ..services import ensure_settings

router = APIRouter(prefix="/api/auth", tags=["auth"])

_GENERIC_AUTH_FAIL = "Incorrect email or password"
_GENERIC_OK = "If that action is applicable it has been processed."

# Explicit allow-list of Firebase sign-in providers we accept. Email-linking an
# existing account relies on Firebase proving mailbox ownership; that guarantee
# only holds for providers we understand. Phone / Apple / federated providers can
# assert an email we have not vetted, so they are rejected until reviewed.
# Real ID-token claim values: email/password = "password", Google = "google.com".
_SUPPORTED_PROVIDERS = {"password", "google.com"}


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _set_session_cookies(response: Response, session_token: str, csrf_token: str) -> None:
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME, value=session_token,
        httponly=True, secure=settings.COOKIE_SECURE, samesite=settings.COOKIE_SAMESITE,
        max_age=settings.SESSION_TTL_SECONDS, path="/",
    )
    # CSRF cookie is readable by JS (non-HttpOnly) so the SPA can echo it back.
    response.set_cookie(
        key=settings.CSRF_COOKIE_NAME, value=csrf_token,
        httponly=False, secure=settings.COOKIE_SECURE, samesite=settings.COOKIE_SAMESITE,
        max_age=settings.SESSION_TTL_SECONDS, path="/",
    )


def _clear_session_cookies(response: Response) -> None:
    response.delete_cookie(settings.SESSION_COOKIE_NAME, path="/")
    response.delete_cookie(settings.CSRF_COOKIE_NAME, path="/")


def _create_session(db: DbSession, user: User, request: Request, response: Response) -> Session:
    raw = new_token()
    csrf = new_csrf()
    sess = Session(
        user_id=user.pk, token_hash=hash_token(raw), csrf_token=csrf,
        expires_at=expires_in(settings.SESSION_TTL_SECONDS),
        user_agent=(request.headers.get("user-agent") or "")[:400],
    )
    db.add(sess)
    _set_session_cookies(response, raw, csrf)
    return sess


def _issue_token(db: DbSession, user_id: str, purpose: str, ttl: int) -> str:
    # Invalidate any outstanding tokens of the same purpose (single, latest wins).
    for t in db.query(AuthToken).filter(
        AuthToken.user_id == user_id, AuthToken.purpose == purpose, AuthToken.used_at.is_(None)
    ).all():
        t.used_at = utcnow()
    raw = new_token()
    db.add(AuthToken(user_id=user_id, purpose=purpose, token_hash=hash_token(raw),
                     expires_at=expires_in(ttl)))
    return raw


def _consume_token(db: DbSession, raw: str, purpose: str) -> User:
    row = db.query(AuthToken).filter(
        AuthToken.token_hash == hash_token(raw), AuthToken.purpose == purpose
    ).one_or_none()
    if row is None or row.used_at is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This link is invalid or has already been used.")
    if _expired(row.expires_at):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This link has expired. Please request a new one.")
    user = db.get(User, row.user_id)
    if user is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This link is invalid or has already been used.")
    row.used_at = utcnow()
    return user


def _expired(dt) -> bool:
    ref = dt if dt.tzinfo is not None else dt.replace(tzinfo=utcnow().tzinfo)
    return ref <= utcnow()


def _revoke_all_sessions(db: DbSession, user_id: str) -> None:
    now = utcnow()
    for s in db.query(Session).filter(Session.user_id == user_id, Session.revoked_at.is_(None)).all():
        s.revoked_at = now


def _reset_link(raw: str) -> str:
    return f"{settings.FRONTEND_ORIGIN}/reset-password?token={raw}"


# --------------------------------------------------------------------------- #
# firebase identity: verify ID token → find / link / provision → own session
# --------------------------------------------------------------------------- #
@router.post("/firebase")
@limiter.limit("10/minute")
def firebase_login(request: Request, payload: FirebaseLoginIn, response: Response,
                   db: DbSession = Depends(get_db)):
    # Verify with the Admin SDK. Identity/verification claims are taken ONLY from
    # the signed token — never from anything the browser supplies separately.
    try:
        decoded = firebase.verify_firebase_token(payload.idToken)
    except firebase.FirebaseNotConfiguredError as exc:
        # Missing project / Admin credential — a server-side 503, not a token fault.
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc))
    except firebase.FirebaseTransientError as exc:
        # Certificate-fetch / transport failure — retryable, server-side 503.
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc))
    except firebase.FirebaseAuthError as exc:
        # Genuine invalid / expired / revoked token → 401 (message is token-status
        # only; it never carries the token).
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc))

    email = normalize_email(decoded.get("email") or "")
    email_verified = bool(decoded["email_verified"])
    uid = decoded["uid"]
    provider = decoded.get("provider")

    if not email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The sign-in has no email address.")

    # Provider allow-list BEFORE any lookup, link or session: only sign-in methods
    # whose mailbox-verification semantics we trust may proceed.
    if provider not in _SUPPORTED_PROVIDERS:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            {"code": "unsupported_provider",
                             "message": "This sign-in method is not supported."})

    # Verification gate BEFORE any session is minted. Google always asserts a
    # verified mailbox; email/password must have completed Firebase verification.
    if not email_verified:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            {"code": "email_not_verified",
                             "message": "Please verify your email before signing in."})

    # 1) Stable identity key: the Firebase UID.
    user = db.query(User).filter(User.firebase_uid == uid).one_or_none()

    if user is None:
        existing = db.query(User).filter(User.email == email).one_or_none()
        if existing is not None:
            # Safe linking: we only attach a Firebase UID to an existing account
            # when Firebase has PROVEN mailbox control (verified email above) —
            # never on a bare email match. A UID already bound to a different
            # Firebase identity is not hijacked.
            if existing.firebase_uid is not None and existing.firebase_uid != uid:
                raise HTTPException(status.HTTP_409_CONFLICT,
                                    "This account is already linked to a different sign-in.")
            existing.firebase_uid = uid
            if existing.email_verified_at is None:
                existing.email_verified_at = utcnow()
            user = existing
        else:
            # JIT provisioning on first verified sign-in. No DB password: identity
            # lives in Firebase. Defaults (settings + built-in records) are
            # self-healed by /api/bootstrap.
            user = User(email=email, password_hash=None, firebase_uid=uid,
                        email_verified_at=utcnow(), onboarded=False)
            db.add(user)
            db.flush()  # obtain pk before dependent rows
            s = ensure_settings(db, user)
            name = (decoded.get("name") or "").strip()
            if name:
                s.preferences = {**s.preferences, "displayName": name[:80]}

    _create_session(db, user, request, response)
    db.commit()
    return UserOut.from_user(user)


# --------------------------------------------------------------------------- #
# register (legacy DB-password accounts) / login / logout / me
# --------------------------------------------------------------------------- #
@router.post("/register", status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
def register(request: Request, payload: RegisterIn, response: Response, db: DbSession = Depends(get_db)):
    # Legacy DB-password provisioning. Retired in production: it creates an
    # account that can no longer complete verification (the custom verify flow
    # is gone), so public legacy registration would only mint unverifiable,
    # Firebase-unaware rows. Tests (ENV=test) and admin/migration tooling still
    # use it; real sign-ups go through Firebase.
    if settings.is_prod:
        raise HTTPException(status.HTTP_410_GONE, "Registration is handled by Firebase.")
    email = normalize_email(str(payload.email))
    if db.query(User).filter(User.email == email).one_or_none() is not None:
        # Registration-time duplicate is surfaced (needed for UX) but does not
        # reveal whether any *other* lookup paths exist.
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists.")

    user = User(email=email, password_hash=hash_password(payload.password), onboarded=False)
    db.add(user)
    db.flush()  # obtain user.pk BEFORE creating dependent rows (point 1)

    settings_row = ensure_settings(db, user)
    settings_row.preferences = {**settings_row.preferences, "displayName": payload.displayName.strip()}
    # Email verification is now handled by Firebase. New users should register
    # through the app's Firebase flow; this endpoint provisions a password-backed
    # account (legacy / tests) without sending a verification email.
    db.commit()
    return {"email": email, "message": "Account created."}


# --------------------------------------------------------------------------- #
# login / logout / me
# --------------------------------------------------------------------------- #
@router.post("/login")
@limiter.limit("10/minute")
def login(request: Request, payload: LoginIn, response: Response, db: DbSession = Depends(get_db)):
    email = normalize_email(str(payload.email))
    user = db.query(User).filter(User.email == email).one_or_none()
    # Uniform failure so account existence can't be probed via login (point 8).
    # A Firebase-only account has no DB password, so password login can't succeed
    # for it — guard against verifying against a None hash.
    if user is None or user.password_hash is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, _GENERIC_AUTH_FAIL)

    if user.email_verified_at is None and not settings.ALLOW_LOGIN_UNVERIFIED:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Please verify your email before signing in.")

    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(payload.password)

    _create_session(db, user, request, response)
    db.commit()
    return UserOut.from_user(user)


@router.post("/logout")
@limiter.limit("30/minute")
def logout(request: Request, response: Response, db: DbSession = Depends(get_db)):
    sess = get_session_from_cookie(request, response, db)
    if sess is not None:
        sess.revoked_at = utcnow()  # genuine server-side revocation (point 9)
    _clear_session_cookies(response)
    db.commit()
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return UserOut.from_user(user)  # point 5


# --------------------------------------------------------------------------- #
# password: forgot / reset / change
# --------------------------------------------------------------------------- #
@router.post("/forgot-password")
@limiter.limit("5/minute")
def forgot_password(request: Request, payload: ForgotIn, db: DbSession = Depends(get_db)):
    email = normalize_email(str(payload.email))
    user = db.query(User).filter(User.email == email).one_or_none()

    # Firebase owns the credential for Firebase identities (rows already linked
    # by uid, or a Firebase account that has not exchanged a token with us yet).
    # The Admin SDK lookup is SERVER-SIDE, so the client response stays identical
    # whether or not the address exists and does not depend on the browser SDK's
    # email-enumeration behaviour. A not-found is simply "not a Firebase user".
    if firebase.is_configured():
        try:
            sent = firebase.send_password_reset_email(
                email, continue_url=f"{settings.FRONTEND_ORIGIN}/login"
            )
        except firebase.FirebaseNotConfiguredError:
            sent = False
        # If Firebase sent it, the identity is Firebase-managed — stop so we never
        # emit a competing legacy link. A Firebase-only row (linked, no DB password)
        # also stops here even if Firebase is momentarily unreachable, because it has
        # no legacy credential to fall back on.
        if sent or (user is not None and user.firebase_uid is not None and user.password_hash is None):
            db.commit()
            return {"message": _GENERIC_OK}

    # Legacy DB-password accounts: server-side single-use token link. Firebase-only
    # accounts have no password_hash and never reach this branch.
    if user is not None and user.password_hash is not None:
        raw = _issue_token(db, user.pk, "password_reset", settings.RESET_TOKEN_TTL_SECONDS)
        try:
            content = reset_email(_reset_link(raw), settings.RESET_TOKEN_TTL_SECONDS // 60)
            mail.send_email(email, content.subject, content.text, content.html)
        except mail.EmailDeliveryError:
            pass  # uniform response regardless of delivery outcome
    db.commit()
    return {"message": _GENERIC_OK}


@router.post("/reset-password")
@limiter.limit("5/minute")
def reset_password(request: Request, payload: ResetIn, response: Response, db: DbSession = Depends(get_db)):
    user = _consume_token(db, payload.token, "password_reset")
    user.password_hash = hash_password(payload.password)
    _revoke_all_sessions(db, user.pk)  # point 9: kill existing sessions on reset
    _clear_session_cookies(response)
    db.commit()
    return {"ok": True}


@router.post("/change-password")
@limiter.limit("5/minute")
def change_password(request: Request, payload: ChangePasswordIn, response: Response,
                    user: User = Depends(get_current_user), db: DbSession = Depends(get_db)):
    require_reauth(db, user, payload.currentPassword)  # re-auth for sensitive change (point 9)
    user.password_hash = hash_password(payload.newPassword)
    _revoke_all_sessions(db, user.pk)  # other sessions must re-authenticate
    _clear_session_cookies(response)
    db.commit()
    return {"ok": True}
