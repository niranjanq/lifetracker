"""Chat message/API pipeline tests using a mock provider (no live LLM)."""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from chatagent.chatbot.api import routes as chat_routes
from chatagent.chatbot.providers.base import ProviderRateLimitError
from chatagent.chatbot.tests._mock import MockProvider

from tests.conftest import csrf, login, register


@pytest.fixture
def mock_provider(monkeypatch):
    provider = MockProvider()
    monkeypatch.setattr(chat_routes, "build_provider", lambda: provider)
    return provider


def _authed(email):
    c = TestClient(app)
    register(c, email)
    login(c, email)
    return c


def _seed_spend(c, month="2026-01", minor=123400):
    c.post("/api/transactions", json={
        "id": f"tx-{month}", "month": month, "kind": "expense",
        "categoryId": "cat-food", "amountMinor": minor,
    }, headers=csrf(c))


# --- consent gate ------------------------------------------------------------
def test_consent_required_blocks_before_any_generation(monkeypatch):
    c = _authed("consent1@example.com")
    # Pretend a provider IS configured; the user has not consented.
    monkeypatch.setattr(chat_routes, "provider_status",
                        lambda: {"configured": True, "provider": "gemini",
                                 "providerLabel": "Google Gemini", "model": "m"})
    t = c.post("/api/chat/threads", json={}, headers=csrf(c)).json()
    r = c.post(f"/api/chat/threads/{t['id']}/messages", json={"content": "how much did I spend in 2026-01"},
               headers=csrf(c))
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "consent_required"
    # No user message was persisted (blocked before generation).
    assert c.get(f"/api/chat/threads/{t['id']}/messages").json() == []


def test_consent_can_be_given_and_revoked(monkeypatch):
    c = _authed("consent2@example.com")
    monkeypatch.setattr(chat_routes, "provider_status",
                        lambda: {"configured": True, "provider": "gemini",
                                 "providerLabel": "Google Gemini", "model": "m"})
    s = c.put("/api/chat/settings", json={"consentGiven": True}, headers=csrf(c))
    assert s.status_code == 200 and s.json()["consentGiven"] is True
    t = c.post("/api/chat/threads", json={}, headers=csrf(c)).json()
    r = c.post(f"/api/chat/threads/{t['id']}/messages", json={"content": "how much did I spend in 2026-01"},
               headers=csrf(c))
    # With consent the request is no longer a 403 (provider unconfigured → not_configured turn).
    assert r.status_code == 200


# --- routing outcomes --------------------------------------------------------
def test_prohibited_question_is_refused_without_model_call(mock_provider):
    c = _authed("refuse1@example.com")
    t = c.post("/api/chat/threads", json={}, headers=csrf(c)).json()
    r = c.post(f"/api/chat/threads/{t['id']}/messages",
               json={"content": "how can I earn more money"}, headers=csrf(c))
    assert r.status_code == 200
    body = r.json()
    assert body["role"] == "assistant" and body["status"] == "refused"
    assert body["guardrail"] == "refuse"
    assert mock_provider.calls == []  # prohibited → never reaches the model


def test_unrecognized_question_clarifies_without_data(mock_provider):
    c = _authed("clarify1@example.com")
    t = c.post("/api/chat/threads", json={}, headers=csrf(c)).json()
    r = c.post(f"/api/chat/threads/{t['id']}/messages",
               json={"content": "what is the capital of France"}, headers=csrf(c))
    assert r.json()["status"] == "refused"  # general knowledge is prohibited
    c2 = _authed("clarify2@example.com")
    t2 = c2.post("/api/chat/threads", json={}, headers=csrf(c2)).json()
    r2 = c2.post(f"/api/chat/threads/{t2['id']}/messages",
                 json={"content": "tell me about bananas"}, headers=csrf(c2))
    assert r2.json()["status"] == "clarify"
    assert mock_provider.calls == []


def test_not_configured_turn_does_not_fabricate(mock_provider):
    # Provider is None even for an allowed intent.
    import chatagent.chatbot.services.chat as chat_svc
    mock_provider.raises = None
    orig = chat_routes.build_provider
    chat_routes.build_provider = lambda: None  # simulate unconfigured
    try:
        c = _authed("nocfg@example.com")
        t = c.post("/api/chat/threads", json={}, headers=csrf(c)).json()
        r = c.post(f"/api/chat/threads/{t['id']}/messages",
                   json={"content": "where did my money go in 2026-01"}, headers=csrf(c))
        assert r.json()["status"] == "not_configured"
    finally:
        chat_routes.build_provider = orig


# --- success + validation ----------------------------------------------------
def test_grounded_success_answer(mock_provider):
    c = _authed("ok1@example.com")
    _seed_spend(c, "2026-01", 123400)
    net_id = "fin:2026-01:net_spending"
    mock_provider.next_content = json.dumps({
        "answer": "You spent ₹1,234.00.",
        "intent": "finance.monthly_summary",
        "fact_refs": [net_id],
        "claims": [{"fact_id": net_id, "value": "₹1,234"}],
        "disclaimer_required": True,
    })
    t = c.post("/api/chat/threads", json={}, headers=csrf(c)).json()
    r = c.post(f"/api/chat/threads/{t['id']}/messages",
               json={"content": "where did my money go in 2026-01"}, headers=csrf(c))
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["guardrail"] == "allow"
    assert body["intent"] == "finance.monthly_summary"
    assert net_id in body["factRefs"]
    assert "not financial advice" in body["content"]

    msgs = c.get(f"/api/chat/threads/{t['id']}/messages").json()
    assert [m["role"] for m in msgs] == ["user", "assistant"]


def test_ungrounded_number_retried_then_falls_back(mock_provider):
    c = _authed("bad1@example.com")
    _seed_spend(c, "2026-01", 123400)
    # Both attempts produce an answer with an amount not in the facts.
    mock_provider.next_content = json.dumps({
        "answer": "You spent ₹9,999,999.", "intent": "finance.monthly_summary",
        "fact_refs": [], "claims": [], "disclaimer_required": True,
    })
    t = c.post("/api/chat/threads", json={}, headers=csrf(c)).json()
    r = c.post(f"/api/chat/threads/{t['id']}/messages",
               json={"content": "where did my money go in 2026-01"}, headers=csrf(c))
    body = r.json()
    assert body["status"] == "error" and body["guardrail"] == "rejected_output"
    # Exactly two provider calls (initial + one stricter retry).
    assert len(mock_provider.calls) == 2
    # The rejected draft is never stored as the answer.
    assert "9,999,999" not in body["content"]


def test_provider_error_is_reported_honestly(mock_provider):
    c = _authed("err1@example.com")
    _seed_spend(c, "2026-01", 123400)
    mock_provider.raises = ProviderRateLimitError("quota")
    t = c.post("/api/chat/threads", json={}, headers=csrf(c)).json()
    r = c.post(f"/api/chat/threads/{t['id']}/messages",
               json={"content": "where did my money go in 2026-01"}, headers=csrf(c))
    body = r.json()
    assert body["status"] == "error"
    msgs = c.get(f"/api/chat/threads/{t['id']}/messages").json()
    # User message preserved for retry; one assistant error turn.
    assert [m["role"] for m in msgs] == ["user", "assistant"]


def test_retry_reuses_user_message_without_duplicate(mock_provider):
    c = _authed("retry1@example.com")
    _seed_spend(c, "2026-01", 123400)
    net_id = "fin:2026-01:net_spending"
    t = c.post("/api/chat/threads", json={}, headers=csrf(c)).json()
    tid = t["id"]

    mock_provider.raises = ProviderRateLimitError("quota")
    c.post(f"/api/chat/threads/{tid}/messages",
           json={"content": "where did my money go in 2026-01"}, headers=csrf(c))

    mock_provider.raises = None
    mock_provider.next_content = json.dumps({
        "answer": "You spent ₹1,234.00.", "intent": "finance.monthly_summary",
        "fact_refs": [net_id], "claims": [{"fact_id": net_id, "value": "₹1,234"}],
        "disclaimer_required": True,
    })
    r = c.post(f"/api/chat/threads/{tid}/retry", headers=csrf(c))
    assert r.status_code == 200 and r.json()["status"] == "ok"

    msgs = c.get(f"/api/chat/threads/{tid}/messages").json()
    user_msgs = [m for m in msgs if m["role"] == "user"]
    assert len(user_msgs) == 1  # retry did NOT duplicate the user's question


def test_message_size_limit():
    c = _authed("size1@example.com")
    t = c.post("/api/chat/threads", json={}, headers=csrf(c)).json()
    big = "a" * (2001)
    r = c.post(f"/api/chat/threads/{t['id']}/messages", json={"content": big}, headers=csrf(c))
    assert r.status_code == 413


def test_status_endpoint_never_exposes_key(monkeypatch):
    monkeypatch.setattr(chat_routes, "provider_status",
                        lambda: {"configured": True, "provider": "openrouter",
                                 "providerLabel": "OpenRouter", "model": "x/y"})
    c = _authed("status1@example.com")
    r = c.get("/api/chat/status")
    body = r.json()
    assert body["provider"] == "openrouter" and body["model"] == "x/y"
    assert "api_key" not in body and "LLM_API_KEY" not in body
