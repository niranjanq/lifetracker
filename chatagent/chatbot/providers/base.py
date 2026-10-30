"""Provider-neutral chat-completion interface + typed errors.

The assistant talks to exactly ONE kind of endpoint (an OpenAI-compatible
`/chat/completions`), but the *configured* provider is inferred from
`LLM_BASE_URL`. This module defines:

- A small, explicit error hierarchy so callers can distinguish auth vs quota vs
  unsupported-model vs network vs malformed-output and react honestly (never a
  silent provider/model switch, never a fabricated answer).
- `resolve_provider()` — a pure, testable URL resolver used at configuration
  time (never on a request-supplied value).
- `ChatProvider` — the minimal interface the rest of the codebase depends on, so
  tests can substitute a mock provider.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from urllib.parse import urlsplit


class ProviderError(Exception):
    """Base class for every provider failure. Carries a safe, non-secret message."""


class ProviderConfigError(ProviderError):
    """Missing/invalid provider configuration, or an unrecognized base URL."""


class ProviderAuthError(ProviderError):
    """The provider rejected our credentials (HTTP 401/403)."""


class ProviderRateLimitError(ProviderError):
    """Quota exhausted or rate-limited (HTTP 429)."""


class ProviderUnsupportedError(ProviderError):
    """The configured model/endpoint is unsupported (HTTP 404 or unknown model)."""


class ProviderConnectionError(ProviderError):
    """Network failure or timeout reaching the provider."""


class ProviderMalformedError(ProviderError):
    """The provider responded, but the body was not a usable completion."""


# --------------------------------------------------------------------------- #
# Provider resolution (config-time only; the base URL is trusted deployment
# configuration and must never be taken from a request).
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class ProviderSpec:
    id: str           # "gemini" | "openrouter" | "xai"
    label: str        # human label for the safe status endpoint
    host: str         # expected netloc
    path_prefix: str  # expected path prefix (OpenAI-compatible base)


KNOWN_PROVIDERS: tuple[ProviderSpec, ...] = (
    ProviderSpec("gemini", "Google Gemini", "generativelanguage.googleapis.com", "/v1beta/openai"),
    ProviderSpec("openrouter", "OpenRouter", "openrouter.ai", "/api/v1"),
    ProviderSpec("xai", "xAI Grok", "api.x.ai", "/v1"),
    ProviderSpec("groq", "Groq", "api.groq.com", "/openai/v1"),
)


def normalize_base_url(base_url: str) -> str:
    """Trim, require a scheme, and strip trailing slashes. Never raises."""
    url = (base_url or "").strip().rstrip("/")
    if url and "://" not in url:
        url = "https://" + url
    return url


def resolve_provider(base_url: str) -> ProviderSpec:
    """Infer the provider from a configured base URL.

    Raises `ProviderConfigError` for an empty/unknown URL. Matching is on the
    lower-cased host AND that the path begins with the known OpenAI-compatible
    prefix, so `.../v1beta/openai/`, `.../api/v1` and `/v1` all resolve, but an
    arbitrary host is rejected rather than silently accepted.
    """
    normalized = normalize_base_url(base_url)
    if not normalized:
        raise ProviderConfigError("LLM_BASE_URL is not configured")
    parts = urlsplit(normalized)
    host = parts.netloc.lower()
    path = (parts.path or "").rstrip("/").lower()
    for spec in KNOWN_PROVIDERS:
        if host == spec.host and (path == spec.path_prefix or path.startswith(spec.path_prefix)):
            return spec
    raise ProviderConfigError(
        f"Unrecognized LLM_BASE_URL host '{host}'. Supported: Gemini, OpenRouter, xAI, Groq."
    )


def completions_url(base_url: str) -> str:
    """Absolute chat-completions endpoint derived from the configured base."""
    return normalize_base_url(base_url) + "/chat/completions"


# --------------------------------------------------------------------------- #
# Completion payload + interface.
# --------------------------------------------------------------------------- #
@dataclass
class CompletionResult:
    content: str
    model: str
    input_tokens: int | None = None
    output_tokens: int | None = None


Message = dict[str, str]  # {"role": "system"|"user"|"assistant", "content": str}


class ChatProvider(ABC):
    """Minimal shared chat-completion interface (common feature subset only)."""

    @property
    @abstractmethod
    def spec(self) -> ProviderSpec: ...

    @abstractmethod
    def complete(
        self,
        messages: list[Message],
        *,
        max_output_tokens: int,
        timeout: float,
        temperature: float = 0.0,
    ) -> CompletionResult:
        """Return raw completion text (validated by the caller). May raise a
        `ProviderError` subclass; never returns fabricated content."""
