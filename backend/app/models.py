"""SQLAlchemy models.

Design notes (the fixes requested):
- UUID primary key (`pk`) is server-generated and INTERNAL; the client-facing
  domain id (e.g. 'cat-food', 'tx-abc') is stored as `external_id`. Ownership is
  the pair (user_id, collection, external_id), so two users can never collide or
  overwrite each other, and a stable domain id is preserved end-to-end.
- All per-user domain records live in one audited `records` table with promoted,
  indexed columns (month/category_id/event_key/log_id/type_id/date) that are
  populated and validated per collection on write (see services.py).
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON, Boolean, DateTime, ForeignKey, Index, String, Text, UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column

from .core.db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"
    pk: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True, index=True)
    # Nullable: identity now lives in Firebase. Legacy password accounts keep a
    # hash here; Google-only / JIT-provisioned Firebase accounts have none.
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Firebase UID is the stable external identity key. Unique + indexed; NULL is
    # allowed (legacy accounts not yet linked). Linking is by UID, never email.
    firebase_uid: Mapped[str | None] = mapped_column(String(128), nullable=True, unique=True, index=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    onboarded: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AccountSettings(Base):
    """Singleton per user holding preferences / roast settings / reminders."""
    __tablename__ = "account_settings"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.pk", ondelete="CASCADE"), primary_key=True)
    preferences: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    roast_settings: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    reminders: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)


class Session(Base):
    __tablename__ = "sessions"
    pk: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.pk", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    csrf_token: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    user_agent: Mapped[str] = mapped_column(String(400), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AuthToken(Base):
    """Email-verification & password-reset tokens. Hash-only, single-use, expiring."""
    __tablename__ = "auth_tokens"
    pk: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.pk", ondelete="CASCADE"), nullable=False, index=True)
    purpose: Mapped[str] = mapped_column(String(32), nullable=False)  # email_verify | password_reset
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (Index("ix_auth_tokens_user_purpose", "user_id", "purpose"),)


class Record(Base):
    """One owned domain record from any collection."""
    __tablename__ = "records"
    pk: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.pk", ondelete="CASCADE"), nullable=False, index=True)
    collection: Mapped[str] = mapped_column(String(64), nullable=False)
    external_id: Mapped[str] = mapped_column(String(120), nullable=False)
    data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    # Promoted, indexed columns (populated & validated per collection on write).
    month: Mapped[str | None] = mapped_column(String(7), nullable=True)
    category_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    event_key: Mapped[str | None] = mapped_column(String(200), nullable=True)
    log_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    type_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    date: Mapped[str | None] = mapped_column(String(10), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "collection", "external_id", name="uq_record_owner_ext"),
        # Roast idempotency per user (event_key is null for all other collections).
        UniqueConstraint("user_id", "collection", "event_key", name="uq_record_event_key"),
        Index("ix_record_user_coll", "user_id", "collection"),
        Index("ix_record_user_coll_month", "user_id", "collection", "month"),
    )


# Collections that participate in the generic, ownership-scoped API.
COLLECTIONS: tuple[str, ...] = (
    "categories", "salaryReceipts", "allocations", "transactions", "budgets",
    "plans", "roastEvents", "healthLogs", "symptoms", "medicationLogs",
    "measurementTypes", "measurementEntries",
)
