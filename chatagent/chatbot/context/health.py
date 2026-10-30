"""Health context builder.

Read-only aggregation over the user's own `healthLogs`, `symptoms`,
`medicationLogs` and `measurementEntries` records for a date range. These are
descriptive summaries of *recorded* data only — the assistant never diagnoses,
judges medication safety, or suggests treatment (that is refused upstream).

Raw free-text notes are intentionally NOT included in the facts (privacy: only
the minimum necessary structured signals are transmitted).
"""
from __future__ import annotations

from ..schemas import Fact
from .money import sum_minor  # noqa: F401  (kept for parity of money imports)


def _d(rec: dict) -> str:
    date = rec.get("date")
    return date[:10] if isinstance(date, str) else ""


def _in_range(date: str, start: str, end: str) -> bool:
    return bool(date) and start <= date <= end


def health_log_summary(logs: list[dict], start: str, end: str) -> dict:
    rows = [l for l in logs if _in_range(_d(l), start, end)]
    ratings = [l.get("wellbeing") for l in rows if isinstance(l.get("wellbeing"), int)]
    return {
        "count": len(rows),
        "days": len({_d(l) for l in rows}),
        "avg_wellbeing": round(sum(ratings) / len(ratings), 2) if ratings else None,
        "sources": [l.get("id") for l in rows if l.get("id")],
    }


def symptom_frequency(symptoms: list[dict], logs: list[dict], start: str, end: str) -> list[dict]:
    """Count + mean severity per symptom name, for symptoms logged in-range.

    Symptoms are linked to a log by `logId`; the log supplies the date.
    """
    log_date = {l.get("id"): _d(l) for l in logs}
    by_name: dict[str, dict] = {}
    for s in symptoms:
        date = log_date.get(s.get("logId"), "")
        if not _in_range(date, start, end):
            continue
        name = (s.get("name") or "unspecified").strip().lower()
        entry = by_name.setdefault(name, {"name": s.get("name") or "Unspecified", "count": 0, "severities": []})
        entry["count"] += 1
        if isinstance(s.get("severity"), int):
            entry["severities"].append(s["severity"])
    out = []
    for entry in by_name.values():
        sev = entry["severities"]
        out.append({
            "name": entry["name"],
            "count": entry["count"],
            "avg_severity": round(sum(sev) / len(sev), 1) if sev else None,
        })
    return sorted(out, key=lambda e: e["count"], reverse=True)


def medication_status(medlogs: list[dict], start: str, end: str) -> dict:
    rows = [m for m in medlogs if _in_range(_d(m), start, end)]
    names = sorted({(m.get("name") or "").strip() for m in rows if m.get("name")})
    return {
        "count": len(rows),
        "days": len({_d(m) for m in rows}),
        "names": names,
        "sources": [m.get("id") for m in rows if m.get("id")],
    }


def measurement_trend(entries: list[dict], start: str, end: str) -> list[dict]:
    """Per measurement type, the in-range series with first/last/delta/avg."""
    by_type: dict[str, list[dict]] = {}
    for e in entries:
        if not _in_range(_d(e), start, end):
            continue
        if e.get("value") is None:
            continue
        by_type.setdefault(e.get("typeId") or "unknown", []).append(e)
    out = []
    for tid, rows in by_type.items():
        rows = sorted(rows, key=_d)
        values = [r["value"] for r in rows]
        first, last = values[0], values[-1]
        out.append({
            "typeId": tid,
            "count": len(values),
            "first": first,
            "last": last,
            "delta": round(last - first, 2),
            "avg": round(sum(values) / len(values), 2),
            "sources": [r.get("id") for r in rows if r.get("id")],
        })
    return sorted(out, key=lambda e: e["count"], reverse=True)


def build_facts(
    *, period_label: str,
    logs: list[dict], symptoms: list[dict], medlogs: list[dict], measurements: list[dict],
    measurement_names: dict[str, str] | None = None,
    start: str, end: str,
) -> list[Fact]:
    measurement_names = measurement_names or {}
    facts: list[Fact] = []

    hs = health_log_summary(logs, start, end)
    facts.append(Fact(
        id=f"hl:{period_label}:log_count", metric="Health logs recorded", kind="count",
        num=float(hs["count"]), display=str(hs["count"]), period=period_label,
        sources=[s for s in hs["sources"] if s],
        completeness="complete" if hs["count"] else "missing",
    ))
    if hs["avg_wellbeing"] is not None:
        facts.append(Fact(
            id=f"hl:{period_label}:wellbeing_avg", metric="Average wellbeing (1-5)", kind="count",
            num=hs["avg_wellbeing"], display=f"{hs['avg_wellbeing']} out of 5", period=period_label,
        ))

    for sf in symptom_frequency(symptoms, logs, start, end)[:8]:
        safe = sf["name"].replace(":", "-").replace(" ", "_").lower()
        facts.append(Fact(
            id=f"sy:{period_label}:{safe}", metric=f"Occurrences of symptom '{sf['name']}'",
            kind="count", num=float(sf["count"]), display=str(sf["count"]), period=period_label,
            completeness="complete",
        ))

    ms = medication_status(medlogs, start, end)
    facts.append(Fact(
        id=f"med:{period_label}:count", metric="Medication entries logged", kind="count",
        num=float(ms["count"]), display=str(ms["count"]), period=period_label,
        sources=[s for s in ms["sources"] if s],
        completeness="complete" if ms["count"] else "missing",
    ))
    if ms["names"]:
        facts.append(Fact(
            id=f"med:{period_label}:names", metric="Medication names logged", kind="text",
            text=", ".join(ms["names"]), display=", ".join(ms["names"]), period=period_label,
        ))

    for mt in measurement_trend(measurements, start, end):
        name = measurement_names.get(mt["typeId"], mt["typeId"])
        facts.append(Fact(
            id=f"me:{period_label}:{mt['typeId']}", metric=f"{name} latest reading", kind="text",
            text=f"first {mt['first']}, latest {mt['last']}, change {mt['delta']}, avg {mt['avg']}",
            display=f"latest {mt['last']} (change {mt['delta']})", period=period_label,
            sources=[s for s in mt["sources"] if s],
        ))

    return facts
