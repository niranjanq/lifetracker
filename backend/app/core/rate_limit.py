"""Rate limiting for authentication endpoints via slowapi."""
from __future__ import annotations

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from .config import settings

limiter = Limiter(key_func=get_remote_address, enabled=settings.RATELIMIT_ENABLED)


def register_rate_limit(app) -> None:
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
