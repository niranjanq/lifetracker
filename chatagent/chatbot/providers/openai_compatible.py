"""One shared OpenAI-compatible adapter used for Gemini, OpenRouter and xAI.

All three providers expose an OpenAI-style `POST {base}/chat/completions`, so a
single `httpx` client covers them; the provider is only *labelled* differently
via `resolve_provider()`. There are deliberately no per-provider code branches
for generation — just a common request shape — and no reliance on provider tool
calling or native JSON-schema modes (the MVP requests strict JSON in the prompt
and validates it independently).

The API key is only ever placed in the request header; it is never logged and
never included in an exception message.
"""
from __future__ import annotations

from typing import Any

import httpx

from .base import (
    ChatProvider, CompletionResult, Message, ProviderAuthError,
    ProviderConnectionError, ProviderError, ProviderMalformedError,
    ProviderRateLimitError, ProviderUnsupportedError, ProviderSpec,
    completions_url, resolve_provider,
)


class OpenAICompatibleProvider(ChatProvider):
    def __init__(self, *, base_url: str, model: str, api_key: str) -> None:
        # Resolve eagerly so a bad/unknown base URL fails at wiring time, not
        # silently on the first user request.
        self._spec = resolve_provider(base_url)
        self._model = model
        self._api_key = api_key
        self._url = completions_url(base_url)

    @property
    def spec(self) -> ProviderSpec:
        return self._spec

    def complete(
        self,
        messages: list[Message],
        *,
        max_output_tokens: int,
        timeout: float,
        temperature: float = 0.0,
    ) -> CompletionResult:
        payload = {
            "model": self._model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_output_tokens,
            "stream": False,
        }
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        try:
            resp = httpx.post(self._url, json=payload, headers=headers, timeout=timeout)
        except httpx.TimeoutException as exc:
            raise ProviderConnectionError("The provider request timed out") from exc
        except httpx.RequestError as exc:
            # Never surface exc.args (may echo request details); keep it generic.
            raise ProviderConnectionError("Could not reach the provider") from exc

        self._raise_for_status(resp)

        try:
            data: Any = resp.json()
        except ValueError as exc:
            raise ProviderMalformedError("Provider returned a non-JSON body") from exc

        content, model, usage = self._extract(data)
        return CompletionResult(
            content=content,
            model=model or self._model,
            input_tokens=usage.get("prompt_tokens"),
            output_tokens=usage.get("completion_tokens"),
        )

    # ------------------------------------------------------------------ #
    @staticmethod
    def _raise_for_status(resp: httpx.Response) -> None:
        if resp.is_success:
            return
        status = resp.status_code
        # Do not echo response bodies (may echo our model name / request info).
        if status in (401, 403):
            raise ProviderAuthError("The provider rejected the configured credentials")
        if status == 429:
            raise ProviderRateLimitError("The provider is rate-limiting or the quota is exhausted")
        if status == 404:
            raise ProviderUnsupportedError("The configured model or endpoint is not available")
        if 500 <= status < 600:
            raise ProviderConnectionError("The provider is temporarily unavailable")
        raise ProviderError(f"The provider returned an unexpected error (HTTP {status})")

    @staticmethod
    def _extract(data: Any) -> tuple[str, str | None, dict]:
        if not isinstance(data, dict):
            raise ProviderMalformedError("Provider response was not an object")
        choices = data.get("choices")
        if not isinstance(choices, list) or not choices:
            raise ProviderMalformedError("Provider response contained no choices")
        first = choices[0] or {}
        message = first.get("message") if isinstance(first, dict) else None
        if not isinstance(message, dict):
            raise ProviderMalformedError("Provider choice contained no message object")
        content = message.get("content")
        if not isinstance(content, str) or content.strip() == "":
            raise ProviderMalformedError("Provider returned empty content")
        usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
        return content, data.get("model"), usage
