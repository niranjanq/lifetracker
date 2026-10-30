"""Chatbot settings.

Reads the three required LLM settings (`LLM_MODEL`, `LLM_BASE_URL`,
`LLM_API_KEY`) plus the assistant's operational limits. Values come from real
environment variables and, for local/dev runs, from the SAME `backend/.env` the
main application already uses — resolved by absolute path so it loads no matter
which directory uvicorn, Alembic or pytest were started from.

The API key never leaves the backend: it is not exposed on any response and is
never interpolated into logs (see `providers/` and `api/status`).
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# This file lives at chatagent/chatbot/config.py; the backend env file is
# <repo-root>/backend/.env.
_ENV_FILE = Path(__file__).resolve().parents[2] / "backend" / ".env"

# Retention policy options (days). None == keep until manually deleted.
RETENTION_OPTIONS: tuple[int | None, ...] = (30, 90, 365, None)
DEFAULT_RETENTION_DAYS = 90


class ChatSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILE, extra="ignore")

    # --- Required provider selection (inferred from LLM_BASE_URL) ------------
    LLM_MODEL: str = ""
    LLM_BASE_URL: str = ""
    LLM_API_KEY: str = ""

    # --- Generation limits ---------------------------------------------------
    LLM_TIMEOUT_SECONDS: float = 30.0
    LLM_MAX_OUTPUT_TOKENS: int = 800
    LLM_TEMPERATURE: float = 0.0

    # --- Request / context / abuse controls ---------------------------------
    CHAT_MAX_MESSAGE_CHARS: int = 2000
    CHAT_MAX_CONTEXT_FACTS: int = 40
    # Per-authenticated-user daily request ceiling (IP limits are insufficient).
    CHAT_DAILY_REQUEST_LIMIT: int = 200

    # --- Retention -----------------------------------------------------------
    CHAT_RETENTION_DAYS: int = DEFAULT_RETENTION_DAYS

    @property
    def is_configured(self) -> bool:
        """True only when all three required provider settings are present.

        When False the assistant must NOT fabricate answers — the API returns a
        clear "not configured" state instead of calling a provider.
        """
        return bool(
            self.LLM_MODEL.strip() and self.LLM_BASE_URL.strip() and self.LLM_API_KEY.strip()
        )

    @property
    def retention_days(self) -> int | None:
        value = self.CHAT_RETENTION_DAYS
        return value if value in (30, 90, 365) else DEFAULT_RETENTION_DAYS


@lru_cache
def get_chat_settings() -> ChatSettings:
    return ChatSettings()


# Module-level singleton, mirroring `app.core.config.settings`.
settings = get_chat_settings()
