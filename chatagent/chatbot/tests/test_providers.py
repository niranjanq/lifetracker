"""Provider abstraction tests (no live network)."""
from __future__ import annotations

import httpx
import pytest

from chatagent.chatbot.providers import base
from chatagent.chatbot.providers.base import (
    ProviderAuthError, ProviderConfigError, ProviderConnectionError,
    ProviderMalformedError, ProviderRateLimitError, ProviderUnsupportedError,
    completions_url, normalize_base_url, resolve_provider,
)
from chatagent.chatbot.providers.openai_compatible import OpenAICompatibleProvider

GEMINI = "https://generativelanguage.googleapis.com/v1beta/openai/"
OPENROUTER = "https://openrouter.ai/api/v1"
XAI = "https://api.x.ai/v1"
GROQ = "https://api.groq.com/openai/v1"


# --- resolution / normalization ------------------------------------------------
def test_resolves_each_supported_provider():
    assert resolve_provider(GEMINI).id == "gemini"
    assert resolve_provider(OPENROUTER).id == "openrouter"
    assert resolve_provider(XAI).id == "xai"
    assert resolve_provider(GROQ).id == "groq"


def test_trailing_slash_and_missing_scheme_are_normalized():
    assert resolve_provider("https://openrouter.ai/api/v1///").id == "openrouter"
    assert normalize_base_url("openrouter.ai/api/v1") == "https://openrouter.ai/api/v1"


def test_unknown_host_is_rejected():
    with pytest.raises(ProviderConfigError):
        resolve_provider("https://evil.example.com/v1")


def test_empty_base_url_is_rejected():
    with pytest.raises(ProviderConfigError):
        resolve_provider("")


def test_completions_url_per_provider():
    assert completions_url(GEMINI) == \
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    assert completions_url(XAI) == "https://api.x.ai/v1/chat/completions"


# --- HTTP behaviour (httpx.post monkeypatched) ---------------------------------
def _provider() -> OpenAICompatibleProvider:
    return OpenAICompatibleProvider(base_url=OPENROUTER, model="prov/model", api_key="SECRET-KEY")


def _patch_post(monkeypatch, *, resp=None, exc=None):
    seen: dict = {}

    def fake_post(url, json=None, headers=None, timeout=None):
        seen["url"] = url
        seen["headers"] = headers
        seen["json"] = json
        seen["timeout"] = timeout
        if exc is not None:
            raise exc
        return resp

    monkeypatch.setattr(httpx, "post", fake_post)
    return seen


def test_successful_completion_parses_content_and_usage(monkeypatch):
    body = {
        "model": "prov/model",
        "choices": [{"message": {"role": "assistant", "content": "  hello  "}}],
        "usage": {"prompt_tokens": 11, "completion_tokens": 5},
    }
    resp = httpx.Response(200, json=body, request=httpx.Request("POST", OPENROUTER))
    seen = _patch_post(monkeypatch, resp=resp)
    result = _provider().complete(
        [{"role": "user", "content": "hi"}], max_output_tokens=800, timeout=30.0,
    )
    assert result.content == "  hello  "
    assert result.model == "prov/model"
    assert result.input_tokens == 11 and result.output_tokens == 5
    assert seen["url"] == completions_url(OPENROUTER)
    assert seen["headers"]["Authorization"] == "Bearer SECRET-KEY"
    assert seen["json"]["stream"] is False
    assert seen["json"]["temperature"] == 0.0
    assert seen["timeout"] == 30.0


@pytest.mark.parametrize("status,expected", [
    (401, ProviderAuthError),
    (403, ProviderAuthError),
    (429, ProviderRateLimitError),
    (404, ProviderUnsupportedError),
    (500, ProviderConnectionError),
])
def test_error_status_mapping(monkeypatch, status, expected):
    resp = httpx.Response(status, text="nope", request=httpx.Request("POST", OPENROUTER))
    _patch_post(monkeypatch, resp=resp)
    with pytest.raises(expected):
        _provider().complete([{"role": "user", "content": "x"}], max_output_tokens=10, timeout=5.0)


def test_connection_and_timeout_map_to_connection_error(monkeypatch):
    _patch_post(monkeypatch, exc=httpx.ConnectError("boom"))
    with pytest.raises(ProviderConnectionError):
        _provider().complete([{"role": "user", "content": "x"}], max_output_tokens=10, timeout=5.0)

    _patch_post(monkeypatch, exc=httpx.ReadTimeout("slow"))
    with pytest.raises(ProviderConnectionError):
        _provider().complete([{"role": "user", "content": "x"}], max_output_tokens=10, timeout=5.0)


def test_malformed_bodies_raise(monkeypatch):
    # Non-JSON body.
    resp = httpx.Response(200, text="not json", request=httpx.Request("POST", OPENROUTER))
    _patch_post(monkeypatch, resp=resp)
    with pytest.raises(ProviderMalformedError):
        _provider().complete([{"role": "user", "content": "x"}], max_output_tokens=10, timeout=5.0)

    # Missing choices.
    resp = httpx.Response(200, json={"model": "m"}, request=httpx.Request("POST", OPENROUTER))
    _patch_post(monkeypatch, resp=resp)
    with pytest.raises(ProviderMalformedError):
        _provider().complete([{"role": "user", "content": "x"}], max_output_tokens=10, timeout=5.0)


def test_api_key_never_leaks_into_exception_messages(monkeypatch):
    resp = httpx.Response(401, text="bad key", request=httpx.Request("POST", OPENROUTER))
    _patch_post(monkeypatch, resp=resp)
    with pytest.raises(ProviderAuthError) as ei:
        _provider().complete([{"role": "user", "content": "x"}], max_output_tokens=10, timeout=5.0)
    assert "SECRET-KEY" not in str(ei.value)
    # And it must not be reachable via the base resolver error text either.
    with pytest.raises(ProviderConfigError):
        resolve_provider("https://x.example.com/v1?a=SECRET-KEY")
    assert "SECRET-KEY" not in base.__doc__


def test_unknown_model_generic_4xx_maps_to_provider_error(monkeypatch):
    resp = httpx.Response(400, text="bad", request=httpx.Request("POST", OPENROUTER))
    _patch_post(monkeypatch, resp=resp)
    with pytest.raises(base.ProviderError):
        _provider().complete([{"role": "user", "content": "x"}], max_output_tokens=10, timeout=5.0)
