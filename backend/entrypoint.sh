#!/usr/bin/env sh
set -e

# Never assume tables exist: apply migrations before serving (point 12).
echo "applying database migrations..."
alembic upgrade head

echo "starting API on :8000..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
