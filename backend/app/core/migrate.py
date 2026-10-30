"""Programmatic Alembic upgrade, used only for non-production auto-migration.

Runs `alembic upgrade head` against the same DATABASE_URL the app already uses,
with an absolute script location so it works regardless of the process CWD.
"""
from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config

# backend/ is two levels up from backend/app/core/migrate.py
_BACKEND_DIR = Path(__file__).resolve().parents[2]


def upgrade_to_head() -> None:
    cfg = Config(str(_BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(_BACKEND_DIR / "alembic"))
    command.upgrade(cfg, "head")
