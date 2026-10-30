# Personal Life Tracker backend package.
#
# Integration bootstrap: the chatbot lives in a separate top-level package at
# the repository root (`chatagent/chatbot/`). When uvicorn/alembic are started
# from the `backend/` directory only `backend/` is on sys.path, so `import
# chatagent` would fail. Registering the repository root here (this module is
# imported before `app.main` and before Alembic's `env.py`) makes the chatbot
# package importable in every entry point without packaging changes.
from __future__ import annotations

import sys
from pathlib import Path

_REPO_ROOT = str(Path(__file__).resolve().parents[2])
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)
