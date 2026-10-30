"""Ownership-scoped data endpoints: bootstrap, generic collection CRUD,
transactional replacement, settings sections, reset, and safe import.

All routes depend on `get_current_user`, which resolves the HttpOnly session
cookie AND enforces CSRF for state-changing verbs. Every query is filtered by the
authenticated user's id, so no record can be read or written across an ownership
boundary.

NOTE: `from __future__ import annotations` is intentionally NOT used in FastAPI
route modules (lazy string annotations can break `Request`/`Response`/body-param
resolution and cause spurious "payload: Field required" 422s).
"""
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session as DbSession

from ..core import defaults
from ..core.db import get_db
from ..deps import get_current_user
from ..models import AccountSettings, COLLECTIONS, Record, User
from ..services import (
    RecordValidationError, delete_record, ensure_settings, load_collection,
    replace_collection, seed_default_records, upsert_record,
)

router = APIRouter(prefix="/api", tags=["data"])

_SETTING_ATTRS = {
    "preferences": "preferences",
    "roastSettings": "roast_settings",
    "reminders": "reminders",
}


def _check_collection(name: str) -> None:
    if name not in COLLECTIONS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown collection: {name}")


@router.get("/bootstrap")
def bootstrap(request: Request, user: User = Depends(get_current_user), db: DbSession = Depends(get_db)):
    # Ensure the settings row + built-in defaults exist (idempotent, self-healing).
    s = ensure_settings(db, user)
    if db.query(Record).filter(Record.user_id == user.pk, Record.collection == "categories").count() == 0:
        seed_default_records(db, user.pk)

    prefs = {**defaults.DEFAULT_PREFERENCES, **(s.preferences or {})}
    prefs["onboarded"] = user.onboarded
    roast = {**defaults.DEFAULT_ROAST_SETTINGS, **(s.roast_settings or {})}
    reminders = {**defaults.DEFAULT_REMINDERS, **(s.reminders or {})}

    db.commit()

    collections: dict[str, list] = {name: load_collection(db, user.pk, name) for name in COLLECTIONS}
    # demoActive is derived from whether any stored record is flagged as demo.
    demo_active = any(
        rec.get("demo") is True
        for rows in collections.values()
        for rec in rows
        if isinstance(rec, dict)
    )
    return {
        "meta": {
            "storageMode": "server",
            "demoActive": demo_active,
            "createdAt": user.created_at.isoformat() if user.created_at else "",
            "schemaVersion": 1,
        },
        "preferences": prefs,
        "roastSettings": roast,
        "reminders": reminders,
        **collections,
    }


# NOTE: The generic "/{collection}" CRUD routes are declared LAST (bottom of
# this module) so that literal one-segment paths such as /import and /reset are
# never captured by the /{collection} path parameter.


@router.put("/settings/{section}")
def update_section(section: str, value: dict[str, Any] = Body(...),
                   user: User = Depends(get_current_user), db: DbSession = Depends(get_db)):
    attr = _SETTING_ATTRS.get(section)
    if attr is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown settings section")
    s = ensure_settings(db, user)
    setattr(s, attr, value)
    if section == "preferences":
        user.onboarded = bool(value.get("onboarded", user.onboarded))
    db.commit()
    return {"ok": True}


@router.post("/reset")
def reset(payload: dict[str, Any] = Body(...),
          user: User = Depends(get_current_user), db: DbSession = Depends(get_db)):
    keep_prefs = bool(payload.get("keepPreferences", True))
    data_collections = [
        "salaryReceipts", "allocations", "transactions", "budgets", "roastEvents",
        "healthLogs", "symptoms", "medicationLogs", "measurementEntries", "plans",
    ]
    for name in data_collections:
        db.query(Record).filter(Record.user_id == user.pk, Record.collection == name).delete(
            synchronize_session=False
        )
    if not keep_prefs:
        db.query(Record).filter(
            Record.user_id == user.pk, Record.collection.in_(["categories", "measurementTypes"])
        ).delete(synchronize_session=False)
        s = ensure_settings(db, user)
        s.preferences = dict(defaults.DEFAULT_PREFERENCES)
        s.roast_settings = dict(defaults.DEFAULT_ROAST_SETTINGS)
        s.reminders = dict(defaults.DEFAULT_REMINDERS)
        seed_default_records(db, user.pk)
    db.commit()
    return {"ok": True}


@router.post("/import")
def import_local(payload: dict[str, Any] = Body(...),
                 user: User = Depends(get_current_user), db: DbSession = Depends(get_db)):
    """Explicit, consent-gated import of a browser (IndexedDB) snapshot.

    Point 2/15: records are ALWAYS created/updated under the authenticated user
    only. There is no code path that changes a row's owner or lets an imported id
    overwrite another user's data, because lookup is scoped to (user, collection,
    external_id). Demo records are skipped unless the caller opts in.
    """
    include_demo = bool(payload.get("includeDemo", False))
    data = payload.get("data", {})
    if not isinstance(data, dict):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "data must be an object")

    # Copy settings (preferences / roast / reminders) if present.
    s = ensure_settings(db, user)
    if isinstance(data.get("preferences"), dict):
        imported_prefs = dict(data["preferences"])
        imported_prefs.pop("onboarded", None)  # onboarded is a server/user field
        s.preferences = {**s.preferences, **imported_prefs}
        user.onboarded = bool(data["preferences"].get("onboarded", user.onboarded))
    if isinstance(data.get("roastSettings"), dict):
        s.roast_settings = {**s.roast_settings, **data["roastSettings"]}
    if isinstance(data.get("reminders"), dict):
        s.reminders = {**s.reminders, **data["reminders"]}

    imported = 0
    skipped_demo = 0
    errors: list[str] = []
    for name in COLLECTIONS:
        rows = data.get(name)
        if not isinstance(rows, list):
            continue
        for rec in rows:
            if not isinstance(rec, dict):
                errors.append(f"{name}: non-object record skipped")
                continue
            if rec.get("demo") is True and not include_demo:
                skipped_demo += 1
                continue
            rec = {**rec, "imported": True}
            try:
                upsert_record(db, user.pk, name, rec)
                imported += 1
            except RecordValidationError as exc:
                errors.append(f"{name}: {exc}")

    if errors:
        db.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {"imported": imported, "errors": errors})
    db.commit()
    return {"ok": True, "imported": imported, "skippedDemo": skipped_demo, "errors": errors}


# --------------------------------------------------------------------------- #
# Generic, ownership-scoped CRUD — declared last on purpose (see note above).
# --------------------------------------------------------------------------- #
@router.post("/{collection}")
def upsert_one(collection: str, record: dict[str, Any] = Body(...),
               user: User = Depends(get_current_user), db: DbSession = Depends(get_db)):
    _check_collection(collection)
    try:
        upsert_record(db, user.pk, collection, record)
    except RecordValidationError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    db.commit()
    return {"ok": True}


@router.put("/{collection}/replace")
def replace(collection: str, items: list[dict[str, Any]] = Body(...),
            user: User = Depends(get_current_user), db: DbSession = Depends(get_db)):
    """Transactional full-set replacement used by the store's rebuild paths.

    Guarantees the collection ends up exactly matching `items` — deleted records
    stay deleted (point 7).
    """
    _check_collection(collection)
    try:
        replace_collection(db, user.pk, collection, items)
    except RecordValidationError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    db.commit()
    return {"ok": True}


@router.delete("/{collection}/{external_id}")
def delete_one(collection: str, external_id: str,
               user: User = Depends(get_current_user), db: DbSession = Depends(get_db)):
    _check_collection(collection)
    removed = delete_record(db, user.pk, collection, external_id)
    db.commit()
    if not removed:
        # 404 (not 204) keeps ownership invisible to other users.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return {"ok": True}
