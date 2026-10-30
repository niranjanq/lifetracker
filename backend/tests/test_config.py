"""Production configuration guard (point 11)."""
from __future__ import annotations

import pytest

from app.core.config import Settings


def _prod(**over):
    base = dict(
        ENV="production",
        SECRET_KEY="x" * 48,
        COOKIE_SECURE=True,
        ALLOW_LOGIN_UNVERIFIED=False,
        DATABASE_URL="postgresql+psycopg://u:pw@db:5432/life_tracker",
        EMAIL_PROVIDER="smtp",
        SMTP_HOST="smtp.provider.com",
        EMAIL_FROM="Personal Life Tracker <no-reply@example.com>",
        FRONTEND_ORIGIN="https://app.example.com",
        FIREBASE_PROJECT_ID="lifetracker-0703",
    )
    base.update(over)
    return Settings(**base)


def test_prod_ok_when_hardened():
    _prod().validate_runtime()  # should not raise


def test_prod_ok_with_resend():
    _prod(EMAIL_PROVIDER="resend", RESEND_API_KEY="re_x").validate_runtime()


@pytest.mark.parametrize("over", [
    {"SECRET_KEY": "change-me-in-production"},
    {"SECRET_KEY": "short"},
    {"COOKIE_SECURE": False},
    {"ALLOW_LOGIN_UNVERIFIED": True},
    {"DATABASE_URL": "sqlite+pysqlite:///:memory:"},
    {"SMTP_HOST": "mailpit"},
    {"EMAIL_PROVIDER": "mailpit"},
    {"EMAIL_PROVIDER": "resend", "RESEND_API_KEY": ""},
    {"EMAIL_FROM": "Personal Life Tracker <no-reply@localhost>"},
    {"FRONTEND_ORIGIN": "http://app.example.com"},
    {"FIREBASE_PROJECT_ID": ""},
])
def test_prod_rejects_insecure(over):
    with pytest.raises(RuntimeError):
        _prod(**over).validate_runtime()


def test_dev_does_not_raise():
    Settings(ENV="dev", SECRET_KEY="whatever").validate_runtime()
