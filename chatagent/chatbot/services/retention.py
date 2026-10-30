"""Retention enforcement.

`run_retention` deletes chat content older than each user's own retention policy
(30/90/365 days), leaving rows alone when the user chose "keep until manually
deleted" (retention_days IS NULL). Threads left with no messages are removed.

It is wired as a real, schedulable command:

    python -m chatagent.chatbot.services.retention

and can also be called from the API/ops tooling. Deletion only affects this app's
own stored chat — it never claims to delete records already transmitted to an
external provider.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session as DbSession

from ..models import ChatMessage, ChatSettingsRecord, ChatThread


def run_retention(db: DbSession, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    deleted_messages = 0
    deleted_threads = 0

    settings_rows = db.query(ChatSettingsRecord).filter(
        ChatSettingsRecord.retention_days.isnot(None)
    ).all()

    for row in settings_rows:
        cutoff = now - timedelta(days=int(row.retention_days))
        n = db.query(ChatMessage).filter(
            ChatMessage.user_id == row.user_id,
            ChatMessage.created_at < cutoff,
        ).delete(synchronize_session=False)
        deleted_messages += n

    # Remove threads that are now empty (their messages aged out or were deleted).
    empty = (
        db.query(ChatThread)
        .outerjoin(ChatMessage, ChatMessage.thread_id == ChatThread.pk)
        .filter(ChatMessage.pk.is_(None))
        .all()
    )
    for t in empty:
        db.delete(t)
        deleted_threads += 1

    db.commit()
    return {"deletedMessages": deleted_messages, "deletedThreads": deleted_threads}


def main() -> None:  # pragma: no cover - thin CLI wrapper
    from app.core.db import SessionLocal

    db = SessionLocal()
    try:
        result = run_retention(db)
        print(f"Retention cleanup complete: {result}")
    finally:
        db.close()


if __name__ == "__main__":  # pragma: no cover
    main()
