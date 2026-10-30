"""FastAPI application entry point."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import auth, resources
from .core.config import settings
from .core.rate_limit import register_rate_limit
from .models import Base  # noqa: F401  (ensures metadata is populated for Alembic)

# The read-only assistant lives in the repo-root `chatagent` package. Importing
# its routes registers its ORM models on the shared Base.metadata and gives us
# the router to mount. `app/__init__.py` puts the repo root on sys.path.
from chatagent.chatbot.api import routes as chat_routes  # noqa: E402

app = FastAPI(title="Personal Life Tracker API", version="1.0.0")

# Fail immediately if production config is unsafe (point 11).
settings.validate_runtime()

register_rate_limit(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-CSRF-Token"],
)

app.include_router(auth.router)
# Mount the chatbot router BEFORE the generic resources router: resources
# exposes `/api/{collection}/{external_id}` delete/upsert patterns that would
# otherwise greedily match specific `/api/chat/...` paths (e.g. DELETE
# /api/chat/history) and 404 them. Starlette matches in registration order.
app.include_router(chat_routes.router)
app.include_router(resources.router)


# In non-production only, apply migrations on startup so a single
# `uvicorn app.main:app` boots without a manual alembic step. Skipped for
# in-memory SQLite (the test suite manages its own schema) and never in prod.
_should_auto_migrate = (
    settings.AUTO_MIGRATE
    and not settings.is_prod
    and ":memory:" not in settings.DATABASE_URL
)

if _should_auto_migrate:

    @app.on_event("startup")
    def _auto_migrate() -> None:
        from .core.migrate import upgrade_to_head

        upgrade_to_head()


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "env": settings.ENV}
