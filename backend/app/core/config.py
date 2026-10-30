"""Application settings with production safety checks."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEFAULT_SECRET = "change-me-in-production"

# Resolve backend/.env by absolute path (this file lives at backend/app/core/),
# so the real config loads regardless of the directory uvicorn was started from.
_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILE, extra="ignore")

    ENV: str = "dev"
    # Local default is a file-based SQLite DB so the app boots with zero
    # infrastructure. docker-compose and production override this via the
    # DATABASE_URL environment variable (validate_runtime enforces Postgres in prod).
    DATABASE_URL: str = "sqlite:///./dev.db"
    DB_FORCE_IPV4: bool = False
    SECRET_KEY: str = _DEFAULT_SECRET
    FRONTEND_ORIGIN: str = "http://localhost:5173"

    # In non-production only: apply Alembic migrations automatically on startup
    # so a single `uvicorn app.main:app` just works. Never assumed in production.
    AUTO_MIGRATE: bool = True

    # Cookie / session
    SESSION_COOKIE_NAME: str = "plt_sid"
    CSRF_COOKIE_NAME: str = "plt_csrf"
    SESSION_TTL_SECONDS: int = 7 * 24 * 3600
    COOKIE_SECURE: bool = False
    COOKIE_SAMESITE: str = "lax"

    # Tokens
    EMAIL_TOKEN_TTL_SECONDS: int = 24 * 3600
    RESET_TOKEN_TTL_SECONDS: int = 30 * 60

    # Email delivery. "mailpit"/"smtp" use the SMTP adapter below (local dev);
    # "resend" uses the Resend HTTPS API (real inboxes). No other provider is
    # selected in application logic.
    EMAIL_PROVIDER: str = "mailpit"
    # Canonical sender for every provider, e.g. "Personal Life Tracker <no-reply@example.com>".
    # Display-only while EMAIL_PROVIDER=mailpit; must be a real verified domain for resend/smtp.
    EMAIL_FROM: str = "Personal Life Tracker <no-reply@lifetracker.app>"

    # SMTP (used when EMAIL_PROVIDER is mailpit/smtp). Mailpit locally; a real
    # provider's SMTP relay in production.
    SMTP_HOST: str = "mailpit"
    SMTP_PORT: int = 1025
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_USE_TLS: bool = False

    # Resend (used when EMAIL_PROVIDER is resend). Key stays server-side only.
    RESEND_API_KEY: str = ""

    # --- Firebase Authentication (identity provider) ----------------------
    # Firebase issues the ID token in the browser; the backend verifies it with
    # the Admin SDK and then mints its own session. Only the PROJECT ID is
    # required to verify tokens; the service-account credential is provided via
    # FIREBASE_CREDENTIALS_PATH (a local JSON file) or Application Default
    # Credentials (GOOGLE_APPLICATION_CREDENTIALS). NEVER ship either secret to
    # the frontend.
    FIREBASE_PROJECT_ID: str = ""
    FIREBASE_CREDENTIALS_PATH: str = ""

    RATELIMIT_ENABLED: bool = True
    # Dev-only escape hatch to sign in before email verification. Enforced False
    # in production; default now enforces verification so the acceptance flow is
    # real. Set ALLOW_LOGIN_UNVERIFIED=true only for quick local testing.
    ALLOW_LOGIN_UNVERIFIED: bool = False

    @property
    def is_prod(self) -> bool:
        return self.ENV.lower() in {"production", "prod"}

    @field_validator("COOKIE_SAMESITE")
    @classmethod
    def _samesite(cls, v: str) -> str:
        if v.lower() not in {"lax", "strict", "none"}:
            raise ValueError("COOKIE_SAMESITE must be lax, strict or none")
        return v.lower()

    def validate_runtime(self) -> None:
        """Fail hard in production if any insecure default is still present."""
        if not self.is_prod:
            return
        problems: list[str] = []
        if self.SECRET_KEY == _DEFAULT_SECRET or len(self.SECRET_KEY) < 32:
            problems.append("SECRET_KEY must be set to a unique 32+ char value in production")
        if not self.COOKIE_SECURE:
            problems.append("COOKIE_SECURE must be true in production (HTTPS-only cookies)")
        if self.ALLOW_LOGIN_UNVERIFIED:
            problems.append("ALLOW_LOGIN_UNVERIFIED must be false in production")
        if not self.DATABASE_URL.startswith("postgresql"):
            problems.append("DATABASE_URL must be PostgreSQL in production")
        provider = self.EMAIL_PROVIDER.lower()
        if provider not in {"resend", "smtp"}:
            problems.append("EMAIL_PROVIDER must be 'resend' or 'smtp' in production (not mailpit)")
        if provider == "resend" and not self.RESEND_API_KEY:
            problems.append("RESEND_API_KEY must be set when EMAIL_PROVIDER=resend")
        if provider == "smtp" and self.SMTP_HOST in {"", "mailpit", "localhost"}:
            problems.append("SMTP_HOST must point at a real mail provider in production")
        if not self.FIREBASE_PROJECT_ID:
            problems.append("FIREBASE_PROJECT_ID must be set in production (Firebase ID-token verification)")
        if "@localhost" in self.EMAIL_FROM or self.EMAIL_FROM.strip() == "":
            problems.append("EMAIL_FROM must be a verified sender identity in production")
        if not self.FRONTEND_ORIGIN.startswith("https://"):
            problems.append("FRONTEND_ORIGIN must be https in production")
        if problems:
            raise RuntimeError("Unsafe production configuration:\n - " + "\n - ".join(problems))


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.validate_runtime()
    return s


settings = get_settings()
