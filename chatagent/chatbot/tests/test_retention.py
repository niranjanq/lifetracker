"""Retention cleanup: per-user policy deletes aged chat; 'keep' retains."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from app.models import User
from chatagent.chatbot.models import ChatThread, ChatMessage
from chatagent.chatbot.services.retention import run_retention
from chatagent.chatbot.services import threads


def _mk_user(db, email):
    u = User(pk=str(uuid.uuid4()), email=email, password_hash="h")
    db.add(u)
    db.flush()
    return u


def _mk_thread_msg(db, user_id, created_at):
    t = ChatThread(pk=str(uuid.uuid4()), user_id=user_id, title="t",
                   created_at=created_at, updated_at=created_at, last_message_at=created_at)
    db.add(t); db.flush()
    m = ChatMessage(pk=str(uuid.uuid4()), thread_id=t.pk, user_id=user_id, role="user",
                    content="hi", status="ok", created_at=created_at)
    db.add(m)
    db.flush()
    return t.pk, m.pk


def test_retention_deletes_aged_messages(db_session):
    now = datetime.now(timezone.utc)
    u = _mk_user(db_session, "ret1@example.com")
    old = now - timedelta(days=45)
    recent = now - timedelta(days=3)
    _old_thread, old_msg = _mk_thread_msg(db_session, u.pk, old)
    _recent_thread, recent_msg = _mk_thread_msg(db_session, u.pk, recent)
    threads.set_retention(db_session, u.pk, 30)

    result = run_retention(db_session, now=now)
    assert result["deletedMessages"] >= 1
    remaining = {m.pk for m in db_session.query(ChatMessage).filter(ChatMessage.user_id == u.pk).all()}
    assert old_msg not in remaining
    assert recent_msg in remaining


def test_keep_until_deleted_retains_all(db_session):
    now = datetime.now(timezone.utc)
    u = _mk_user(db_session, "ret2@example.com")
    _mk_thread_msg(db_session, u.pk, now - timedelta(days=400))
    threads.set_retention(db_session, u.pk, None)  # keep until manually deleted

    run_retention(db_session, now=now)
    assert db_session.query(ChatMessage).filter(ChatMessage.user_id == u.pk).count() == 1


def test_retention_is_per_user(db_session):
    now = datetime.now(timezone.utc)
    a = _mk_user(db_session, "retA@example.com")
    b = _mk_user(db_session, "retB@example.com")
    _mk_thread_msg(db_session, a.pk, now - timedelta(days=100))
    _mk_thread_msg(db_session, b.pk, now - timedelta(days=100))
    threads.set_retention(db_session, a.pk, 30)   # A ages out
    threads.set_retention(db_session, b.pk, 365)  # B keeps

    run_retention(db_session, now=now)
    assert db_session.query(ChatMessage).filter(ChatMessage.user_id == a.pk).count() == 0
    assert db_session.query(ChatMessage).filter(ChatMessage.user_id == b.pk).count() == 1

def test_retention_does_not_delete_another_users_empty_thread(db_session):
    now = datetime.now(timezone.utc)

    a = _mk_user(db_session, "ret_empty_a@example.com")
    b = _mk_user(db_session, "ret_empty_b@example.com")

    # User A has an old message that should expire.
    _mk_thread_msg(db_session, a.pk, now - timedelta(days=45))
    threads.set_retention(db_session, a.pk, 30)

    # User B has an intentionally empty thread.
    empty_thread = ChatThread(
        pk=str(uuid.uuid4()),
        user_id=b.pk,
        title="My empty conversation",
        created_at=now,
        updated_at=now,
        last_message_at=None,
    )
    db_session.add(empty_thread)
    db_session.flush()

    threads.set_retention(db_session, b.pk, 365)

    run_retention(db_session, now=now)

    # User B's thread must not be deleted by User A's cleanup.
    remaining = db_session.query(ChatThread).filter(
        ChatThread.pk == empty_thread.pk
    ).one_or_none()

    assert remaining is not None
