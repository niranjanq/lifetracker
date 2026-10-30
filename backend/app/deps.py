"""Auth dependencies: session resolution (HttpOnly cookie) + CSRF + re-auth."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session as DbSession

from .core.config import settings
from .core.db import get_db
from .core.security import hash_token, verify_password
from .models import Session, User

_MUTATING = {"POST", "PUT", "PATCH", "DELETE"}


def _aware(dt):
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def get_session_from_cookie(request: Request, response: Response, db: DbSession) -> Session | None:
    token = request.cookies.get(settings.SESSION_COOKIE_NAME)
    if not token:
        return None
    sess = db.query(Session).filter(Session.token_hash == hash_token(token)).one_or_none()
    if sess is None:
        return None
    now = datetime.now(timezone.utc)
    if sess.revoked_at is not None or _aware(sess.expires_at) <= now:
        return None
    # CSRF (double-submit bound to the server session) for state-changing verbs.
    if request.method in _MUTATING:
        header = request.headers.get("X-CSRF-Token", "")
        if not header or header != sess.csrf_token:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid or missing CSRF token")
    sess.last_seen_at = now
    return sess


def get_current_user(
    request: Request,
    response: Response,
    db: DbSession = Depends(get_db),
) -> User:
    sess = get_session_from_cookie(request, response, db)
    if sess is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    user = db.get(User, sess.user_id)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    return user


def require_reauth(db: DbSession, user: User, current_password: str) -> None:
    """Sensitive changes re-verify the password (point 9). Firebase-only accounts
    have no DB password to re-check, so this path is unavailable to them."""
    if user.password_hash is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "This sign-in is managed by Firebase. Use the emailed password-reset link.",
        )
    if not verify_password(current_password, user.password_hash):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Current password is incorrect")
