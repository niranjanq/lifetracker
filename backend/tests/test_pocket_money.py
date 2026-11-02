"""Parent pocket-money allocation: the group pseudo-category id must persist
through the generic, ownership-scoped record path, and legacy category-based
allocations must keep round-tripping unchanged. The feature introduces NO
migration — this file is the backward-compatibility proof."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

from .conftest import csrf, login, register

PM_ALLOC = {
    "id": "alloc-pm", "month": "2026-11", "categoryId": "group-pocket-money",
    "label": "Pocket money", "plannedMinor": 1000000,
    "createdAt": "2026-11-01T00:00:00.000Z",
}


def _auth(client, email):
    register(client, email)
    login(client, email)


def test_parent_allocation_persists_and_survives_bootstrap(client):
    _auth(client, "pm1@example.com")
    r = client.post("/api/allocations", json=PM_ALLOC, headers=csrf(client))
    assert r.status_code == 200, r.text
    rows = client.get("/api/bootstrap").json()["allocations"]
    pm = [a for a in rows if a["categoryId"] == "group-pocket-money"]
    assert len(pm) == 1 and pm[0]["plannedMinor"] == 1000000


def test_legacy_category_allocations_still_round_trip(client):
    _auth(client, "pm2@example.com")
    legacy = {
        "id": "alloc-rent", "month": "2026-11", "categoryId": "cat-rent",
        "label": "Room rent", "plannedMinor": 800000, "createdAt": "2026-11-01T00:00:00.000Z",
    }
    assert client.post("/api/allocations", json=legacy, headers=csrf(client)).status_code == 200
    assert client.post("/api/allocations", json=PM_ALLOC, headers=csrf(client)).status_code == 200
    rows = client.get("/api/bootstrap").json()["allocations"]
    assert {a["id"] for a in rows} == {"alloc-rent", "alloc-pm"}


def test_pocket_money_allocation_requires_csrf(client):
    _auth(client, "pm3@example.com")
    assert client.post("/api/allocations", json=PM_ALLOC).status_code == 403


def test_pocket_money_allocation_requires_session():
    anon = TestClient(app)
    assert anon.post("/api/allocations", json=PM_ALLOC).status_code in (401, 403)
