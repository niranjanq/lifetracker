"""The chat turn pipeline.

Order (mirrors the message-endpoint contract in the spec):
1. persist the user's message;
2. deterministically route the intent (refuse / clarify / allow);
3. on *allow*: require a configured provider and consent (enforced by the route);
4. build user-scoped, minimized facts;
5. ask the model for strict JSON, parse and validate it (grounding + numbers +
   scope);
6. on validation failure retry ONCE with a stricter instruction, then fall back
   to a deterministic safe response;
7. persist the final assistant message (success, refusal, clarify, error or
   fallback) and return it.

No partial streaming, no fabricated answer when the provider is unavailable or
unconfigured, and no silent provider/model switch — errors are persisted truthfully
so the UI can offer a retry (the retry path reuses the stored user message and
does not duplicate it).
"""
from __future__ import annotations

import json
import re
from datetime import date

from sqlalchemy.orm import Session as DbSession

from ..config import settings
from ..context.builder import ContextBundle, build_context
from ..providers.base import ChatProvider, Message, ProviderError
from ..safety import intent as intent_mod
from ..safety import policy
from ..safety.intent import IntentResult
from ..safety.output_validation import validate_response
from ..schemas import ChatStructuredResponse, FINANCE_INTENTS, HEALTH_INTENTS
from . import threads

_NOT_CONFIGURED = (
    "The assistant isn't configured yet, so I can't answer. A provider and model "
    "must be set on the server first — I won't invent an answer."
)
_UNAVAILABLE = (
    "The AI provider is unavailable right now, so I couldn't produce a verified "
    "answer. Your message is saved — please try again shortly."
)
_FALLBACK = (
    "I couldn't produce an answer I could fully verify against your records, so I "
    "won't display an unverified one. Please try again or rephrase."
)

_SYSTEM = (
    "You are a read-only assistant for one user's OWN recorded financial and health "
    "data. You are given authoritative FACTS (already computed) and must ONLY restate "
    "them in natural language. NEVER compute, estimate or invent any number, percentage "
    "or date, and never give financial or medical advice, diagnoses or recommendations. "
    "If a value is not in the FACTS, do not state it. Respond with ONLY a single JSON "
    "object, no prose outside it, matching exactly this schema:\n"
    '{"answer": string, "intent": string, "fact_refs": string[], '
    '"claims": [{"fact_id": string, "value": string}], "disclaimer_required": boolean}\n'
    'Every currency/percentage number you write in "answer" MUST equal a FACT value '
    '(e.g. "₹40,000"). List the fact ids you relied on in "fact_refs" and mirror them '
    'in "claims". Set "intent" to the provided intent and "disclaimer_required" to true '
    "for finance or health answers."
)

_JSON_FENCE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)


def _extract_json(text: str) -> dict | None:
    if not text:
        return None
    fence = _JSON_FENCE.search(text)
    candidate = fence.group(1) if fence else text.strip()
    try:
        obj = json.loads(candidate)
    except (ValueError, TypeError):
        # Fall back to the first balanced {...} block.
        start = candidate.find("{")
        end = candidate.rfind("}")
        if start == -1 or end <= start:
            return None
        try:
            obj = json.loads(candidate[start:end + 1])
        except (ValueError, TypeError):
            return None
    return obj if isinstance(obj, dict) else None


def _messages(question: str, bundle: ContextBundle, ir: IntentResult, *, stricter: bool) -> list[Message]:
    facts = bundle.prompt_block(settings.CHAT_MAX_CONTEXT_FACTS)
    user_block = (
        f"INTENT: {ir.intent}\nPERIOD: {bundle.period_label}\n"
        f"FACTS (authoritative, use verbatim only):\n{facts}\n\n"
        f"QUESTION: {question}\n\n"
    )
    if stricter:
        user_block += (
            "STRICT RETRY: your previous answer failed validation. Output ONLY numbers "
            "that exactly match a FACT value, reference real fact ids, add no advice."
        )
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": user_block},
    ]


class _Reject(Exception):
    pass


def _attempt(provider: ChatProvider, question: str, bundle: ContextBundle,
             ir: IntentResult, *, stricter: bool):
    result = provider.complete(
        _messages(question, bundle, ir, stricter=stricter),
        max_output_tokens=settings.LLM_MAX_OUTPUT_TOKENS,
        timeout=settings.LLM_TIMEOUT_SECONDS,
        temperature=settings.LLM_TEMPERATURE,
    )
    data = _extract_json(result.content)
    if data is None:
        raise _Reject("model output was not valid JSON")
    try:
        resp = ChatStructuredResponse.model_validate(data)
    except Exception as exc:  # pydantic ValidationError
        raise _Reject(f"schema mismatch: {exc}") from exc
    validation = validate_response(resp, bundle, ir.intent)
    if not validation.ok:
        raise _Reject("; ".join(validation.errors))
    return resp, result


def _disclaimer(domain: str | None) -> str:
    if domain == "health":
        return "\n\nThis is an informational summary of your own recorded data, not medical advice."
    return "\n\nThis is an informational summary of your own recorded data, not financial advice."


def route_only(question: str, today: date | None = None) -> IntentResult:
    return intent_mod.route(question, today=today)


def generate_answer(
    db: DbSession,
    *,
    provider: ChatProvider | None,
    user_id: str,
    thread_id: str,
    question: str,
    currency: str = "INR",
    today: date | None = None,
) -> dict:
    """Persist the user message and produce+persist the assistant turn."""
    today = today or date.today()
    threads.add_message(db, user_id=user_id, thread_id=thread_id, role="user",
                        content=question, status="ok")
    ir = intent_mod.route(question, today=today)

    def _assistant(content: str, status: str, *, guardrail: str, intent: str | None = None,
                   refs: list[str] | None = None, model: str | None = None,
                   itok: int | None = None, otok: int | None = None) -> dict:
        m = threads.add_message(
            db, user_id=user_id, thread_id=thread_id, role="assistant", content=content,
            status=status, intent=intent, guardrail=guardrail, fact_refs=refs, model=model,
            input_tokens=itok, output_tokens=otok,
        )
        db.commit()
        return threads._message_to_dict(m)

    if ir.decision == "refuse":
        return _assistant(ir.message or policy.refusal_message("general_knowledge"),
                          "refused", guardrail="refuse", refs=[])
    if ir.decision == "clarify":
        return _assistant(ir.message or "I can only help with your own recorded finance/health data.",
                          "clarify", guardrail="clarify", refs=[])

    # Allowed intent, but generation requires a configured provider.
    if provider is None:
        return _assistant(_NOT_CONFIGURED, "not_configured", guardrail="allow", intent=ir.intent, refs=[])

    bundle = build_context(db, user_id, ir, currency)
    try:
        resp, result = _attempt(provider, question, bundle, ir, stricter=False)
    except _Reject:
        # One controlled retry with a stricter instruction.
        try:
            resp, result = _attempt(provider, question, bundle, ir, stricter=True)
        except _Reject:
            return _assistant(_FALLBACK, "error", guardrail="rejected_output", intent=ir.intent, refs=[])
        except ProviderError:
            return _assistant(_UNAVAILABLE, "error", guardrail="allow", intent=ir.intent, refs=[])
    except ProviderError:
        return _assistant(_UNAVAILABLE, "error", guardrail="allow", intent=ir.intent, refs=[])

    text = resp.answer.strip() + _disclaimer(ir.domain)
    return _assistant(
        text, "ok", guardrail="allow", intent=ir.intent, refs=resp.fact_refs,
        model=result.model, itok=result.input_tokens, otok=result.output_tokens,
    )


def retry_last(db: DbSession, *, provider: ChatProvider | None, user_id: str,
               thread_id: str, currency: str = "INR", today: date | None = None) -> dict | None:
    """Re-generate the assistant answer for the last user message WITHOUT adding a
    duplicate user message (used after a failed/error turn)."""
    msgs = threads.list_messages(db, user_id, thread_id)
    if msgs is None:
        return None
    last_user = next((m for m in reversed(msgs) if m["role"] == "user"), None)
    if last_user is None:
        return None
    ir = intent_mod.route(last_user["content"], today=today or date.today())
    if not ir.is_allowed:
        # Re-route deterministic outcome only (no provider call).
        content = ir.message or policy.refusal_message("general_knowledge")
        status = "refused" if ir.decision == "refuse" else "clarify"
        m = threads.add_message(db, user_id=user_id, thread_id=thread_id, role="assistant",
                                content=content, status=status, guardrail=ir.decision)
        db.commit()
        return threads._message_to_dict(m)

    if provider is None:
        m = threads.add_message(db, user_id=user_id, thread_id=thread_id, role="assistant",
                                content=_NOT_CONFIGURED, status="not_configured", guardrail="allow",
                                intent=ir.intent)
        db.commit()
        return threads._message_to_dict(m)

    bundle = build_context(db, user_id, ir, currency)
    try:
        try:
            resp, result = _attempt(provider, last_user["content"], bundle, ir, stricter=False)
        except _Reject:
            resp, result = _attempt(provider, last_user["content"], bundle, ir, stricter=True)
    except _Reject:
        content, status, refs, model, itok, otok = _FALLBACK, "error", [], None, None, None
    except ProviderError:
        content, status, refs, model, itok, otok = _UNAVAILABLE, "error", [], None, None, None
    else:
        content = resp.answer.strip() + _disclaimer(ir.domain)
        status, refs, model = "ok", resp.fact_refs, result.model
        itok, otok = result.input_tokens, result.output_tokens
    m = threads.add_message(db, user_id=user_id, thread_id=thread_id, role="assistant",
                            content=content, status=status, guardrail="allow", intent=ir.intent,
                            fact_refs=refs, model=model, input_tokens=itok, output_tokens=otok)
    db.commit()
    return threads._message_to_dict(m)
