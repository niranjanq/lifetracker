"""Domain-record services: validation, indexed-column extraction and the
ownership-scoped write operations.

Every write is keyed by (user_id, collection, external_id) so a record can never
be read, modified, imported or deleted across an ownership boundary (points 2,3,7).
"""
from __future__ import annotations

import re
from typing import Any, Iterable

from sqlalchemy.orm import Session as DbSession

from .core import defaults
from .models import COLLECTIONS, AccountSettings, Record, User

_MONTH = re.compile(r"^\d{4}-\d{2}$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")

COLLECTION_SET = set(COLLECTIONS)

# Amount-bearing fields that MUST be integers (minor units / paise) if present.
_INT_FIELDS = (
    "amountMinor", "plannedMinor", "spentMinor", "expectedSalaryMinor",
    "actualReceivedMinor", "refundedMinor", "transferOutMinor", "investedMinor",
    "incomeMinor", "limitMinor",
)

# Enum-ish fields and the allowed values, validated only when present.
_ENUM_FIELDS: dict[str, set[str]] = {
    "kind": {"income", "expense", "transfer", "investment"},
    "defaultKind": {"income", "expense", "transfer", "investment"},
    "scope": {"month", "category"},
    "status": {"planned", "actual", "over", "under"},
}

# Which promoted columns each collection populates.
_DATE_COLLECTIONS = {"healthLogs", "symptoms", "medicationLogs", "measurementEntries"}
_MONTH_COLLECTIONS = {
    "transactions", "salaryReceipts", "allocations", "budgets", "plans", "roastEvents",
}


class RecordValidationError(ValueError):
    """Raised when a client-supplied record violates a model invariant."""


def get_external_id(collection: str, data: dict[str, Any]) -> str:
    """Stable per-user id. Plans are keyed by month (PlanRecord has no `id`)."""
    if collection == "plans":
        ext = data.get("month")
    else:
        ext = data.get("id")
    if not isinstance(ext, str) or not ext:
        raise RecordValidationError(f"{collection}: missing string id")
    if len(ext) > 120:
        raise RecordValidationError(f"{collection}: id too long")
    return ext


def extract_indexes(collection: str, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "month": data.get("month") if collection in _MONTH_COLLECTIONS else None,
        "category_id": data.get("categoryId") if collection in ("transactions", "budgets") else None,
        "event_key": data.get("eventKey") if collection == "roastEvents" else None,
        "log_id": data.get("logId") if collection == "measurementEntries" else None,
        "type_id": data.get("typeId") if collection == "measurementEntries" else None,
        "date": data.get("date") if collection in _DATE_COLLECTIONS else None,
    }


def validate_record(collection: str, data: Any) -> dict[str, Any]:
    """Enforce type consistency + per-collection invariants (point 3)."""
    if collection not in COLLECTION_SET:
        raise RecordValidationError(f"unknown collection: {collection}")
    if not isinstance(data, dict):
        raise RecordValidationError(f"{collection}: record must be an object")

    get_external_id(collection, data)  # validates id presence

    for field in _INT_FIELDS:
        if field in data and data[field] is not None:
            v = data[field]
            # bool is a subclass of int in Python — reject it explicitly.
            if isinstance(v, bool) or not isinstance(v, int):
                raise RecordValidationError(f"{collection}.{field} must be an integer (minor units)")

    for field, allowed in _ENUM_FIELDS.items():
        if field in data and data[field] is not None and data[field] not in allowed:
            raise RecordValidationError(f"{collection}.{field} has invalid value")

    month = data.get("month")
    if month is not None and not _MONTH.match(month):
        raise RecordValidationError(f"{collection}.month must be YYYY-MM")

    date = data.get("date")
    if date is not None and not _DATE.match(date):
        raise RecordValidationError(f"{collection}.date must be YYYY-MM-DD")

    # Health / measurement values must never be silently coerced to zero.
    if collection == "measurementEntries" and "value" in data:
        if data["value"] is not None and not isinstance(data["value"], (int, float)):
            raise RecordValidationError("measurementEntries.value must be a number")

    return data


def _query(db: DbSession, user_id: str, collection: str):
    return db.query(Record).filter(
        Record.user_id == user_id, Record.collection == collection
    )


def upsert_record(db: DbSession, user_id: str, collection: str, data: dict[str, Any]) -> Record:
    """Insert-or-update one owned record within the caller's open transaction."""
    validate_record(collection, data)
    ext = get_external_id(collection, data)
    idx = extract_indexes(collection, data)
    row = _query(db, user_id, collection).filter(Record.external_id == ext).one_or_none()
    if row is None:
        row = Record(user_id=user_id, collection=collection, external_id=ext, data=data, **idx)
        db.add(row)
    else:
        row.data = data
        for k, v in idx.items():
            setattr(row, k, v)
    return row


def delete_record(db: DbSession, user_id: str, collection: str, external_id: str) -> bool:
    n = _query(db, user_id, collection).filter(Record.external_id == external_id).delete(
        synchronize_session=False
    )
    return n > 0


def replace_collection(db: DbSession, user_id: str, collection: str, items: Iterable[dict]) -> list[Record]:
    """Transactional full-set replacement — never resurrects deleted records (point 7)."""
    items = list(items)
    kept: set[str] = set()
    rows: list[Record] = []
    for data in items:
        validate_record(collection, data)
        ext = get_external_id(collection, data)
        kept.add(ext)
        rows.append(upsert_record(db, user_id, collection, data))
    # Remove any owned record of this collection not present in the new set.
    if kept:
        _query(db, user_id, collection).filter(Record.external_id.notin_(kept)).delete(
            synchronize_session=False
        )
    else:
        _query(db, user_id, collection).delete(synchronize_session=False)
    db.flush()
    return rows


def load_collection(db: DbSession, user_id: str, collection: str) -> list[dict]:
    return [r.data for r in _query(db, user_id, collection).all()]


def ensure_settings(db: DbSession, user: User) -> AccountSettings:
    """Get or lazily create the user's settings row (never orphaned — user exists first)."""
    row = db.get(AccountSettings, user.pk)
    if row is None:
        row = AccountSettings(
            user_id=user.pk,
            preferences=dict(defaults.DEFAULT_PREFERENCES),
            roast_settings=dict(defaults.DEFAULT_ROAST_SETTINGS),
            reminders=dict(defaults.DEFAULT_REMINDERS),
        )
        db.add(row)
    return row


def seed_default_records(db: DbSession, user_id: str) -> None:
    """Seed built-in categories + measurement types with their stable domain IDs."""
    existing = {r.external_id for r in _query(db, user_id, "categories").all()}
    for cat in defaults.DEFAULT_CATEGORIES:
        if cat["id"] not in existing:
            upsert_record(db, user_id, "categories", dict(cat))
    existing_mt = {r.external_id for r in _query(db, user_id, "measurementTypes").all()}
    for mt in defaults.DEFAULT_MEASUREMENT_TYPES:
        if mt["id"] not in existing_mt:
            upsert_record(db, user_id, "measurementTypes", dict(mt))
