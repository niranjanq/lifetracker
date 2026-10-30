"""Security primitives: Argon2id password hashing + hashed, single-use tokens.

Only HASHES of tokens/sessions are ever stored, so a database leak cannot be
replayed. Passwords use Argon2id via the open-source argon2-cffi reference.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher, Type as Argon2Type
from argon2.exceptions import InvalidHashError, VerifyMismatchError

_hasher = PasswordHasher(
    time_cost=3,
    memory_cost=65536,  # 64 MiB
    parallelism=1,
    hash_len=32,
    type=Argon2Type.ID,  # Argon2id
)


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    try:
        return _hasher.verify(hashed, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def password_needs_rehash(hashed: str) -> bool:
    try:
        return _hasher.check_needs_rehash(hashed)
    except InvalidHashError:
        return True


def new_token() -> str:
    """High-entropy opaque token, returned to the client exactly once."""
    return secrets.token_urlsafe(32)


def new_csrf() -> str:
    return secrets.token_urlsafe(24)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def expires_in(seconds: int) -> datetime:
    return utcnow() + timedelta(seconds=seconds)


def normalize_email(raw: str) -> str:
    """Single canonical email form used everywhere (register/login/lookup)."""
    return raw.strip().lower()
