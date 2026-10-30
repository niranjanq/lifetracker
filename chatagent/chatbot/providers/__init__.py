"""Provider package: exports the interface, errors, resolver and a factory.

`build_provider()` returns a configured `ChatProvider` or `None` when the three
required settings are absent — callers must treat `None` as "not configured" and
never fabricate an answer in that state.
"""
from __future__ import annotations

from ..config import settings
from .base import (
    ChatProvider, CompletionResult, Message, ProviderAuthError,
    ProviderConfigError, ProviderConnectionError, ProviderError,
    ProviderMalformedError, ProviderRateLimitError, ProviderSpec,
    ProviderUnsupportedError, resolve_provider,
)
from .openai_compatible import OpenAICompatibleProvider

__all__ = [
    "ChatProvider", "CompletionResult", "Message", "ProviderError",
    "ProviderConfigError", "ProviderAuthError", "ProviderRateLimitError",
    "ProviderUnsupportedError", "ProviderConnectionError", "ProviderMalformedError",
    "ProviderSpec", "OpenAICompatibleProvider", "resolve_provider",
    "build_provider", "provider_status",
]


def build_provider() -> ChatProvider | None:
    """Construct the configured provider, or None if generation is disabled."""
    if not settings.is_configured:
        return None
    return OpenAICompatibleProvider(
        base_url=settings.LLM_BASE_URL,
        model=settings.LLM_MODEL,
        api_key=settings.LLM_API_KEY,
    )


def provider_status() -> dict:
    """Safe, key-free configuration snapshot for the status endpoint.

    Exposes only the inferred provider id/label and the configured model. It
    NEVER includes the API key, the base URL, or any record data.
    """
    if not settings.is_configured:
        return {"configured": False, "provider": None, "providerLabel": None, "model": None}
    try:
        spec = resolve_provider(settings.LLM_BASE_URL)
    except ProviderConfigError:
        return {"configured": False, "provider": None, "providerLabel": None, "model": None,
                "error": "invalid_base_url"}
    return {
        "configured": True,
        "provider": spec.id,
        "providerLabel": spec.label,
        "model": settings.LLM_MODEL,
    }
