"""Pydantic request/response models."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from .models import User


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=200)
    displayName: str = Field(default="", max_length=80)


# Login uses its own model (point 8): password has no length floor so an existing
# account with a legacy/short password can still authenticate; email is validated.
class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class ForgotIn(BaseModel):
    email: EmailStr


class ResetIn(BaseModel):
    token: str = Field(min_length=8, max_length=200)
    password: str = Field(min_length=10, max_length=200)


class ChangePasswordIn(BaseModel):
    currentPassword: str = Field(min_length=1, max_length=200)
    newPassword: str = Field(min_length=10, max_length=200)


# Firebase identity assertion: the browser hands us an ID token; the backend
# verifies it with the Admin SDK. min_length guards against empty/garbage posts
# before we spend a network round-trip on verification.
class FirebaseLoginIn(BaseModel):
    idToken: str = Field(min_length=20, max_length=4096)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=False)
    email: EmailStr
    emailVerified: bool
    onboarded: bool
    # Whether the account has a DB password. Firebase-only accounts (password
    # managed by Firebase) report False; the UI hides in-app password change for
    # them and uses the emailed reset instead.
    hasPassword: bool

    @staticmethod
    def from_user(user: User) -> "UserOut":
        # Explicit mapping (point 5): the ORM stores email_verified_at, not a
        # boolean, so a naive model_validate would fail here.
        return UserOut(
            email=user.email,
            emailVerified=user.email_verified_at is not None,
            onboarded=user.onboarded,
            hasPassword=user.password_hash is not None,
        )


class SectionUpdate(BaseModel):
    """Body for PUT /api/settings/{section}; a raw JSON object for that section."""
    model_config = ConfigDict(extra="allow")
