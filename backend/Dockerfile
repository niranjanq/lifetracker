FROM python:3.13-slim

# Dumb-init for correct signal handling; libpq for psycopg if the binary wheel is unavailable.
RUN apt-get update \
  && apt-get install -y --no-install-recommends dumb-init libpq5 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/app

# Build context is the REPOSITORY ROOT (see docker-compose.yml), because the
# read-only assistant package `chatagent/` lives next to `backend/` and must be
# importable by the app. Backend paths are therefore prefixed with `backend/`.
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY backend/alembic.ini ./
COPY backend/alembic ./alembic
COPY backend/entrypoint.sh ./entrypoint.sh
# The assistant package sits on /app (== PYTHONPATH) so `import chatagent` works
# exactly as it does in the dev checkout via backend/app/__init__.py's sys.path bootstrap.
COPY chatagent ./chatagent
RUN chmod +x ./entrypoint.sh

# Run as an unprivileged user.
RUN useradd -m -u 10001 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["./entrypoint.sh"]
