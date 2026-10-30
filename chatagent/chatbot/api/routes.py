"""Chatbot HTTP API, mounted by the existing FastAPI app under /api/chat.

Auth + CSRF come from the shared `get_current_user` dependency; every query is
scoped to the authenticated user id, so cross-user access is impossible. The
message endpoint enforces size + per-user daily limits and the external-processing
consent gate BEFORE any fact is retrieved or sent to a provider.

NOTE: `from __future__ import annotations` is intentionally NOT used in this
FastAPI route module (lazy string annotations can break Request/Response/body
resolution). Pydantic request models below use concrete, resolvable annotations.
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session as DbSession

from app.core.db import get_db
from app.deps import get_current_user
from app.models import User
from app.services import ensure_settings

from ..config import settings
from ..models import ChatMessage
from ..providers import build_provider, provider_status
from ..services import chat, retention, threads

router = APIRouter(prefix="/api/chat", tags=["assistant"])

_RETENTION_ALLOWED = {30, 90, 365, None}


class CreateThreadIn(BaseModel):
    title: str = Field(default="New conversation", max_length=200)


class RenameThreadIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class MessageIn(BaseModel):
    content: str = Field(min_length=1)


class SettingsIn(BaseModel):
    consentGiven: Optional[bool] = None
    retentionDays: Optional[int] = None
    keepUntilDeleted: Optional[bool] = None


def _require_thread(db: DbSession, user_id: str, thread_id: str):
    t = threads.get_thread(db, user_id, thread_id)
    if t is None:  # 404 keeps other users' thread ids indistinguishable
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return t


def _currency(db: DbSession, user: User) -> str:
    s = ensure_settings(db, user)
    return (s.preferences or {}).get("currency", "INR")


def _check_size(content: str) -> None:
    if len(content) > settings.CHAT_MAX_MESSAGE_CHARS:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"Message too long (max {settings.CHAT_MAX_MESSAGE_CHARS} characters)",
        )


def _check_daily_limit(db: DbSession, user_id: str) -> None:
    start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    used = (
        db.query(ChatMessage)
        .filter(ChatMessage.user_id == user_id, ChatMessage.role == "user",
                ChatMessage.created_at >= start)
        .count()
    )
    if used >= settings.CHAT_DAILY_REQUEST_LIMIT:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Daily assistant request limit reached for today. Please try again tomorrow.",
        )


def _consent_guard(db: DbSession, user_id: str) -> None:
    """Refuse to transmit personal facts unless the user consented for THIS provider."""
    status_info = provider_status()
    if not status_info["configured"]:
        return  # chat service returns a clear "not configured" turn
    row = threads.get_settings(db, user_id)
    if not row.consent_given or row.consent_provider != status_info["provider"]:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail={
                "code": "consent_required",
                "provider": status_info["provider"],
                "providerLabel": status_info["providerLabel"],
                "model": status_info["model"],
            },
        )


# --- status / provider -------------------------------------------------------
@router.get("/status")
def get_status(user: User = Depends(get_current_user)) -> dict:
    return provider_status()


# --- settings + consent + retention ------------------------------------------
@router.get("/settings")
def get_chat_settings(db: DbSession = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    return threads.settings_to_dict(threads.get_settings(db, user.pk))


@router.put("/settings")
def put_chat_settings(
    payload: SettingsIn,
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    info = provider_status()
    if payload.consentGiven is not None:
        threads.set_consent(db, user.pk, info.get("provider"), payload.consentGiven)
    if payload.keepUntilDeleted is not None:
        threads.set_retention(db, user.pk, None if payload.keepUntilDeleted else (payload.retentionDays or 90))
    elif payload.retentionDays is not None:
        if payload.retentionDays not in _RETENTION_ALLOWED:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid retention option")
        threads.set_retention(db, user.pk, payload.retentionDays)
    db.commit()
    return threads.settings_to_dict(threads.get_settings(db, user.pk))


# --- threads -----------------------------------------------------------------
@router.post("/threads")
def create_thread(payload: CreateThreadIn = None, db: DbSession = Depends(get_db),
                  user: User = Depends(get_current_user)) -> dict:
    title = payload.title if payload else "New conversation"
    return threads.create_thread(db, user.pk, title)


@router.get("/threads")
def list_threads(db: DbSession = Depends(get_db), user: User = Depends(get_current_user)) -> list:
    return threads.list_threads(db, user.pk)


@router.get("/threads/{thread_id}")
def get_thread(thread_id: str, db: DbSession = Depends(get_db),
               user: User = Depends(get_current_user)) -> dict:
    t = _require_thread(db, user.pk, thread_id)
    return _thread_dict(t)


@router.patch("/threads/{thread_id}")
def rename_thread(thread_id: str, payload: RenameThreadIn, db: DbSession = Depends(get_db),
                  user: User = Depends(get_current_user)) -> dict:
    _require_thread(db, user.pk, thread_id)
    return threads.rename_thread(db, user.pk, thread_id, payload.title)


@router.delete("/threads/{thread_id}")
def delete_thread(thread_id: str, db: DbSession = Depends(get_db),
                  user: User = Depends(get_current_user)) -> dict:
    _require_thread(db, user.pk, thread_id)
    threads.delete_thread(db, user.pk, thread_id)
    return {"ok": True}


# --- messages ----------------------------------------------------------------
@router.get("/threads/{thread_id}/messages")
def get_messages(thread_id: str, db: DbSession = Depends(get_db),
                 user: User = Depends(get_current_user)) -> list:
    _require_thread(db, user.pk, thread_id)
    return threads.list_messages(db, user.pk, thread_id) or []


@router.post("/threads/{thread_id}/messages")
def post_message(thread_id: str, payload: MessageIn, db: DbSession = Depends(get_db),
                 user: User = Depends(get_current_user)) -> dict:
    _require_thread(db, user.pk, thread_id)
    _check_size(payload.content)
    _consent_guard(db, user.pk)
    _check_daily_limit(db, user.pk)
    return chat.generate_answer(
        db, provider=build_provider(), user_id=user.pk, thread_id=thread_id,
        question=payload.content.strip(), currency=_currency(db, user),
    )


@router.post("/threads/{thread_id}/retry")
def retry_message(thread_id: str, db: DbSession = Depends(get_db),
                  user: User = Depends(get_current_user)) -> dict:
    """Regenerate the last answer without duplicating the user message."""
    _require_thread(db, user.pk, thread_id)
    _consent_guard(db, user.pk)
    _check_daily_limit(db, user.pk)
    result = chat.retry_last(
        db, provider=build_provider(), user_id=user.pk, thread_id=thread_id,
        currency=_currency(db, user),
    )
    if result is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Nothing to retry")
    return result


# --- export ------------------------------------------------------------------
@router.get("/export")
def export_all(db: DbSession = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    return threads.export_all(db, user.pk)


@router.get("/threads/{thread_id}/export")
def export_thread(thread_id: str, db: DbSession = Depends(get_db),
                  user: User = Depends(get_current_user)) -> dict:
    _require_thread(db, user.pk, thread_id)
    return threads.export_thread(db, user.pk, thread_id)


# --- history deletion --------------------------------------------------------
@router.delete("/history")
def delete_history(db: DbSession = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    n = threads.delete_all_history(db, user.pk)
    return {"ok": True, "deletedMessages": n}


# --- retention maintenance (ops) ---------------------------------------------
@router.post("/maintenance/retention")
def run_retention(db: DbSession = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    # Authenticated maintenance trigger; a scheduler or CLI (`python -m
    # chatagent.chatbot.services.retention`) runs the same logic unattended.
    return retention.run_retention(db)


def _thread_dict(t) -> dict:
    return {
        "id": t.pk, "title": t.title,
        "createdAt": t.created_at.isoformat() if t.created_at else None,
        "updatedAt": t.updated_at.isoformat() if t.updated_at else None,
        "lastMessageAt": t.last_message_at.isoformat() if t.last_message_at else None,
    }

