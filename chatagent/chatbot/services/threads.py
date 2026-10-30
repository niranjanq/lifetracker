"""Thread, message and per-user assistant-settings persistence.

Every function filters by the authenticated `user_id`; there is no code path that
reads or writes across an ownership boundary. Timestamps are stored tz-aware UTC,
matching the rest of the app.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session as DbSession

from ..models import ChatMessage, ChatSettingsRecord, ChatThread


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _to_dict(t: ChatThread) -> dict:
    return {
        "id": t.pk, "title": t.title,
        "createdAt": t.created_at.isoformat() if t.created_at else None,
        "updatedAt": t.updated_at.isoformat() if t.updated_at else None,
        "lastMessageAt": t.last_message_at.isoformat() if t.last_message_at else None,
    }


def _message_to_dict(m: ChatMessage) -> dict:
    return {
        "id": m.pk, "threadId": m.thread_id, "role": m.role, "content": m.content,
        "status": m.status, "intent": m.intent, "guardrail": m.guardrail,
        "factRefs": m.fact_refs or [], "model": m.model,
        "inputTokens": m.input_tokens, "outputTokens": m.output_tokens,
        "createdAt": m.created_at.isoformat() if m.created_at else None,
    }


# --- threads -----------------------------------------------------------------
def create_thread(db: DbSession, user_id: str, title: str = "New conversation") -> dict:
    now = _now()
    t = ChatThread(user_id=user_id, title=(title or "New conversation")[:200],
                   created_at=now, updated_at=now)
    db.add(t)
    db.commit()
    db.refresh(t)
    return _to_dict(t)


def list_threads(db: DbSession, user_id: str) -> list[dict]:
    rows = (
        db.query(ChatThread)
        .filter(ChatThread.user_id == user_id)
        .order_by(ChatThread.updated_at.desc())
        .all()
    )
    return [_to_dict(t) for t in rows]


def get_thread(db: DbSession, user_id: str, thread_id: str) -> ChatThread | None:
    return db.query(ChatThread).filter(
        ChatThread.pk == thread_id, ChatThread.user_id == user_id
    ).one_or_none()


def rename_thread(db: DbSession, user_id: str, thread_id: str, title: str) -> dict | None:
    t = get_thread(db, user_id, thread_id)
    if t is None:
        return None
    t.title = (title or t.title)[:200]
    t.updated_at = _now()
    db.commit()
    db.refresh(t)
    return _to_dict(t)


def delete_thread(db: DbSession, user_id: str, thread_id: str) -> bool:
    t = get_thread(db, user_id, thread_id)
    if t is None:
        return False
    db.query(ChatMessage).filter(ChatMessage.thread_id == t.pk).delete(synchronize_session=False)
    db.delete(t)
    db.commit()
    return True


# --- messages ----------------------------------------------------------------
def list_messages(db: DbSession, user_id: str, thread_id: str) -> list[dict] | None:
    if get_thread(db, user_id, thread_id) is None:
        return None
    rows = (
        db.query(ChatMessage)
        .filter(ChatMessage.thread_id == thread_id, ChatMessage.user_id == user_id)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )
    return [_message_to_dict(m) for m in rows]


def add_message(
    db: DbSession, *, user_id: str, thread_id: str, role: str, content: str, status: str,
    intent: str | None = None, guardrail: str | None = None, fact_refs: list[str] | None = None,
    model: str | None = None, input_tokens: int | None = None, output_tokens: int | None = None,
) -> ChatMessage:
    now = _now()
    m = ChatMessage(
        thread_id=thread_id, user_id=user_id, role=role, content=content, status=status,
        intent=intent, guardrail=guardrail, fact_refs=fact_refs or [], model=model,
        input_tokens=input_tokens, output_tokens=output_tokens, created_at=now,
    )
    db.add(m)
    t = db.get(ChatThread, thread_id)
    if t is not None:
        t.updated_at = now
        t.last_message_at = now
    db.flush()
    return m


# --- export ------------------------------------------------------------------
def export_thread(db: DbSession, user_id: str, thread_id: str) -> dict | None:
    t = get_thread(db, user_id, thread_id)
    if t is None:
        return None
    return {"thread": _to_dict(t), "messages": list_messages(db, user_id, thread_id) or []}


def export_all(db: DbSession, user_id: str) -> dict:
    threads = list_threads(db, user_id)
    return {
        "exportedAt": _now().isoformat(),
        "threads": [
            {"thread": th, "messages": list_messages(db, user_id, th["id"]) or []}
            for th in threads
        ],
    }


def delete_all_history(db: DbSession, user_id: str) -> int:
    n = db.query(ChatMessage).filter(ChatMessage.user_id == user_id).delete(synchronize_session=False)
    db.query(ChatThread).filter(ChatThread.user_id == user_id).delete(synchronize_session=False)
    db.commit()
    return n


# --- settings ----------------------------------------------------------------
def get_settings(db: DbSession, user_id: str) -> ChatSettingsRecord:
    row = db.get(ChatSettingsRecord, user_id)
    if row is None:
        row = ChatSettingsRecord(user_id=user_id, consent_given=False, retention_days=90)
        db.add(row)
        db.flush()
    return row


def set_consent(db: DbSession, user_id: str, provider_id: str | None, given: bool) -> ChatSettingsRecord:
    row = get_settings(db, user_id)
    row.consent_given = bool(given)
    row.consent_provider = provider_id if given else row.consent_provider
    row.consent_at = _now() if given else None
    row.updated_at = _now()
    db.commit()
    db.refresh(row)
    return row


def set_retention(db: DbSession, user_id: str, retention_days: int | None) -> ChatSettingsRecord:
    row = get_settings(db, user_id)
    row.retention_days = retention_days
    row.updated_at = _now()
    db.commit()
    db.refresh(row)
    return row


def settings_to_dict(row: ChatSettingsRecord) -> dict:
    return {
        "consentGiven": bool(row.consent_given),
        "consentProvider": row.consent_provider,
        "retentionDays": row.retention_days,
    }
