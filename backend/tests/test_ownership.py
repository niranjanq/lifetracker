"""Cross-user ownership isolation (the requested two-user test) and record
validation. Two separate authenticated sessions attempt to read, modify, import
and delete each other's records.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

from .conftest import csrf, login, register


def _authed(email):
    c = TestClient(app)
    register(c, email)
    login(c, email)
    return c


def _bootstrap_ids(c, collection):
    b = c.get("/api/bootstrap")
    assert b.status_code == 200, b.text
    return {rec["id"] for rec in b.json()[collection]}


def test_users_cannot_read_each_other_records():
    a = _authed("alice2@example.com")
    b = _authed("bob2@example.com")

    tx = {"id": "tx-shared", "month": "2026-01", "kind": "expense", "amountMinor": 5000, "categoryId": "cat-food"}
    assert a.post("/api/transactions", json=tx, headers=csrf(a)).status_code == 200

    assert "tx-shared" in _bootstrap_ids(a, "transactions")
    # Bob's data must not contain Alice's transaction.
    assert "tx-shared" not in _bootstrap_ids(b, "transactions")


def test_user_cannot_delete_another_users_record():
    a = _authed("alice3@example.com")
    b = _authed("bob3@example.com")
    a.post("/api/transactions", json={"id": "tx-x", "month": "2026-01", "kind": "expense", "amountMinor": 10}, headers=csrf(a))

    # Bob deletes "tx-x" -> must be 404 (ownership is invisible), and Alice keeps it.
    r = b.delete("/api/transactions/tx-x", headers=csrf(b))
    assert r.status_code == 404
    assert "tx-x" in _bootstrap_ids(a, "transactions")


def test_same_external_id_is_independent_per_user():
    a = _authed("alice4@example.com")
    b = _authed("bob4@example.com")
    a.post("/api/transactions", json={"id": "tx-same", "month": "2026-01", "kind": "expense", "amountMinor": 100}, headers=csrf(a))
    # Bob creates his OWN record with the same id; it must not overwrite Alice's.
    b.post("/api/transactions", json={"id": "tx-same", "month": "2026-01", "kind": "expense", "amountMinor": 999}, headers=csrf(b))

    def amount(c):
        for rec in c.get("/api/bootstrap").json()["transactions"]:
            if rec["id"] == "tx-same":
                return rec["amountMinor"]
    assert amount(a) == 100
    assert amount(b) == 999


def test_import_cannot_hijack_other_users_data():
    a = _authed("alice5@example.com")
    b = _authed("bob5@example.com")
    a.post("/api/transactions", json={"id": "tx-imp", "month": "2026-01", "kind": "expense", "amountMinor": 250}, headers=csrf(a))

    # Bob imports a payload that reuses Alice's id but can only ever write to Bob's store.
    payload = {"includeDemo": False, "data": {"transactions": [{"id": "tx-imp", "month": "2026-01", "kind": "expense", "amountMinor": 777}]}}
    r = b.post("/api/import", json=payload, headers=csrf(b))
    assert r.status_code == 200, r.text

    def amount(c):
        for rec in c.get("/api/bootstrap").json()["transactions"]:
            if rec["id"] == "tx-imp":
                return rec["amountMinor"]
    assert amount(a) == 250          # Alice untouched
    assert amount(b) == 777          # Bob's own copy
    # imported flag recorded on Bob's copy
    brec = next(x for x in b.get("/api/bootstrap").json()["transactions"] if x["id"] == "tx-imp")
    assert brec.get("imported") is True


def test_import_respects_demo_consent():
    a = _authed("alice6@example.com")
    demo_tx = {"id": "tx-demo", "month": "2026-01", "kind": "expense", "amountMinor": 100, "demo": True}
    r_no = a.post("/api/import", json={"includeDemo": False, "data": {"transactions": [demo_tx]}}, headers=csrf(a))
    assert r_no.status_code == 200
    assert r_no.json()["skippedDemo"] == 1
    assert "tx-demo" not in _bootstrap_ids(a, "transactions")

    r_yes = a.post("/api/import", json={"includeDemo": True, "data": {"transactions": [demo_tx]}}, headers=csrf(a))
    assert r_yes.status_code == 200
    assert "tx-demo" in _bootstrap_ids(a, "transactions")


def test_record_validation_rejects_bad_amount():
    a = _authed("alice7@example.com")
    bad = {"id": "tx-bad", "month": "2026-01", "kind": "expense", "amountMinor": "5000"}
    r = a.post("/api/transactions", json=bad, headers=csrf(a))
    assert r.status_code == 422


def test_replace_collection_does_not_resurrect():
    a = _authed("alice8@example.com")
    a.post("/api/healthLogs", json={"id": "hl-1", "date": "2026-01-01", "mood": 4}, headers=csrf(a))
    a.post("/api/healthLogs", json={"id": "hl-2", "date": "2026-01-02", "mood": 3}, headers=csrf(a))
    # Replace with only hl-2 -> hl-1 must be gone (no resurrection on reload).
    r = a.put("/api/healthLogs/replace", json=[{"id": "hl-2", "date": "2026-01-02", "mood": 3}], headers=csrf(a))
    assert r.status_code == 200, r.text
    assert _bootstrap_ids(a, "healthLogs") == {"hl-2"}
