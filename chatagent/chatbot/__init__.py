"""Personal Life Tracker read-only assistant.

A grounded, security-bounded chat assistant that answers questions about the
authenticated user's *own* financial and health records. Facts are produced by
deterministic backend functions over the existing `records` data; a configurable
OpenAI-compatible LLM provider only phrases those facts, and every response is
validated (fact references, numeric claims, scope policy) before it is returned.

Nothing here imports unrelated finance/health/auth *implementation* — the
assistant reuses the existing app's trusted read path and auth dependency, and
owns only its own ORM models, provider adapter, context builders, safety layer
and API routes.
"""
