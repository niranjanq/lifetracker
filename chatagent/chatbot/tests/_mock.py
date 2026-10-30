"""Deterministic mock provider used by chatbot unit tests.

Implements the same `ChatProvider` interface as the real adapter so the whole
pipeline (routing → context → generation → validation) is exercised without any
network call. Tests set `next_content` to the exact JSON string the model would
have produced, or inject a `raises` error to test failure handling.
"""
from __future__ import annotations

from chatagent.chatbot.providers.base import (
    ChatProvider, CompletionResult, Message, ProviderSpec,
)

MOCK_SPEC = ProviderSpec("openrouter", "Mock (OpenAI-compatible)", "openrouter.ai", "/api/v1")


class MockProvider(ChatProvider):
    def __init__(self) -> None:
        self.next_content: str = "{}"
        self.raises: Exception | None = None
        self.calls: list[list[Message]] = []

    @property
    def spec(self) -> ProviderSpec:
        return MOCK_SPEC

    def complete(
        self,
        messages: list[Message],
        *,
        max_output_tokens: int,
        timeout: float,
        temperature: float = 0.0,
    ) -> CompletionResult:
        self.calls.append(messages)
        if self.raises is not None:
            raise self.raises
        return CompletionResult(
            content=self.next_content, model="mock-model",
            input_tokens=None, output_tokens=None,
        )
