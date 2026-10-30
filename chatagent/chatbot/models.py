"""Chatbot ORM models (owned by the chatbot package, on the shared Base).

Reuses the application's identifier convention: a String(36) UUID primary key
`pk`, a `user_id` foreign key to `users.pk` with CASCADE, and portable column
types so the same models run on SQLite (dev/CI) and PostgreSQL (prod).

Ownership is enforced structurally:
- `ChatMessage.thread_id` is a foreign key to `chat_threads.id`, and every thread
  belongs to exactly one user, so a message can never reference a thread owned by
  someone else without violating the FK.
- `ChatMessage.user_id` is denormalised for cheap per-user scoping and is always
  written to equal the thread's owner (enforced in the service layer).

Only minimal metadata is stored on messages — the stable `fact_refs` (ids) and
guardrail verdict, never raw record blobs or full context snapshots.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, Text, func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class ChatThread(Base):
    __tablename__ = "chat_threads"
    pk: Mapped[str] = mapped_column("id", String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.pk", ondelete="CASCADE"), nullable=False, index=True,
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="New conversation")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    pk: Mapped[str] = mapped_column("id", String(36), primary_key=True, default=_uuid)
    thread_id: Mapped[str] = mapped_column(
        ForeignKey("chat_threads.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.pk", ondelete="CASCADE"), nullable=False, index=True,
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)          # user | assistant
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Completion / error state for the turn: ok | refused | clarify | error |
    # needs_consent | not_configured.
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="ok")
    intent: Mapped[str | None] = mapped_column(String(48), nullable=True)
    guardrail: Mapped[str | None] = mapped_column(String(24), nullable=True)  # allow|refuse|clarify|rejected_output
    fact_refs: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_chat_message_thread_created", "thread_id", "created_at"),
        Index("ix_chat_message_user_created", "user_id", "created_at"),
    )


class ChatSettingsRecord(Base):
    """Per-user assistant settings: external-processing consent + retention."""
    __tablename__ = "chat_settings"
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.pk", ondelete="CASCADE"), primary_key=True,
    )
    consent_given: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    consent_provider: Mapped[str | None] = mapped_column(String(48), nullable=True)
    consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Retention in days; NULL means "keep until manually deleted".
    retention_days: Mapped[int | None] = mapped_column(Integer, nullable=True, default=90)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
