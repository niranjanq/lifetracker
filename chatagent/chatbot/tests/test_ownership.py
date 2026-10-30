"""Cross-user chat isolation: user B cannot read/modify/export/delete user A."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import csrf, login, register


def _authed(email):
    c = TestClient(app)
    register(c, email)
    login(c, email)
    return c


def _thread_with_msg(c, text="how can I earn more money"):
    t = c.post("/api/chat/threads", json={"title": "A's chat"}, headers=csrf(c)).json()
    c.post(f"/api/chat/threads/{t['id']}/messages", json={"content": text}, headers=csrf(c))
    return t["id"]


def test_user_b_cannot_read_user_a_thread_or_messages():
    a = _authed("a_own@example.com")
    b = _authed("b_own@example.com")
    tid = _thread_with_msg(a)

    assert b.get(f"/api/chat/threads/{tid}").status_code == 404
    assert b.get(f"/api/chat/threads/{tid}/messages").status_code == 404
    assert b.get(f"/api/chat/threads/{tid}/export").status_code == 404
    # And it never appears in B's own listings.
    assert tid not in {t["id"] for t in b.get("/api/chat/threads").json()}


def test_user_b_cannot_modify_or_delete_user_a_thread():
    a = _authed("a_own2@example.com")
    b = _authed("b_own2@example.com")
    tid = _thread_with_msg(a)

    assert b.patch(f"/api/chat/threads/{tid}", json={"title": "hijack"}, headers=csrf(b)).status_code == 404
    assert b.delete(f"/api/chat/threads/{tid}", headers=csrf(b)).status_code == 404
    # Alice's thread is untouched.
    assert a.get(f"/api/chat/threads/{tid}").status_code == 200


def test_export_all_only_contains_own_threads():
    a = _authed("a_exp@example.com")
    b = _authed("b_exp@example.com")
    atid = _thread_with_msg(a)
    btid = _thread_with_msg(b)

    aexp = a.get("/api/chat/export").json()
    ids = {entry["thread"]["id"] for entry in aexp["threads"]}
    assert ids == {atid} and btid not in ids


def test_delete_history_only_affects_own_user():
    a = _authed("a_del@example.com")
    b = _authed("b_del@example.com")
    atid = _thread_with_msg(a)
    btid = _thread_with_msg(b)

    assert b.delete("/api/chat/history", headers=csrf(b)).status_code == 200
    # Alice still has her thread; Bob's is gone.
    assert a.get(f"/api/chat/threads/{atid}").status_code == 200
    assert b.get(f"/api/chat/threads/{btid}").status_code == 404


def test_no_authentication_returns_401():
    anon = TestClient(app)
    assert anon.get("/api/chat/threads").status_code == 401
