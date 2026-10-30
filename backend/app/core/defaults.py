"""Server-side seeds mirroring src/domain/{categories,roast,repo/local}.ts.

Category IDs are the SAME stable domain IDs the frontend uses (e.g. 'cat-food').
They are stored as a per-user `external_id`, so two different users may both own
a 'cat-food' category without any collision or cross-user leakage.
"""
from __future__ import annotations

DEFAULT_PREFERENCES = {
    "displayName": "", "currency": "INR", "timeZone": "Asia/Kolkata",
    "budgetPeriod": "calendar", "theme": "dark", "reducedMotion": False,
    "remindersEnabled": False, "onboarded": False,
}

DEFAULT_ROAST_SETTINGS = {
    "enabled": True, "intensity": "balanced", "thresholds": [75, 90, 100, 120],
    "notifyOnCross": True, "excludedCategoryIds": [], "quietHoursEnabled": False,
    "quietHoursStart": "22:00", "quietHoursEnd": "07:00",
}

DEFAULT_REMINDERS = {
    "healthDailyLog": False, "medication": False, "budgetReview": False,
    "timeOfDay": "20:00",
}

DEFAULT_CATEGORIES = [
    {"id": "cat-salary", "name": "Salary", "icon": "Wallet", "essential": False, "defaultKind": "income", "builtin": True},
    {"id": "cat-other-income", "name": "Other income", "icon": "Coins", "essential": False, "defaultKind": "income", "builtin": True},
    {"id": "cat-food", "name": "Food & groceries", "icon": "UtensilsCrossed", "essential": True, "defaultKind": "expense", "builtin": True},
    {"id": "cat-transport", "name": "Transport", "icon": "BusFront", "essential": False, "defaultKind": "expense", "builtin": True},
    {"id": "cat-rent", "name": "Rent", "icon": "Home", "essential": True, "defaultKind": "transfer", "builtin": True},
    {"id": "cat-bills", "name": "Bills", "icon": "Receipt", "essential": True, "defaultKind": "expense", "builtin": True},
    {"id": "cat-shopping", "name": "Shopping", "icon": "ShoppingBag", "essential": False, "defaultKind": "expense", "builtin": True},
    {"id": "cat-entertainment", "name": "Entertainment", "icon": "Clapperboard", "essential": False, "defaultKind": "expense", "builtin": True},
    {"id": "cat-health", "name": "Health & medicines", "icon": "Pill", "essential": True, "defaultKind": "expense", "builtin": True},
    {"id": "cat-family", "name": "Family transfers", "icon": "HeartHandshake", "essential": True, "defaultKind": "transfer", "builtin": True},
    {"id": "cat-savings", "name": "Savings", "icon": "PiggyBank", "essential": False, "defaultKind": "transfer", "builtin": True},
    {"id": "cat-sip", "name": "SIP / investments", "icon": "TrendingUp", "essential": False, "defaultKind": "investment", "builtin": True},
    {"id": "cat-education", "name": "Education", "icon": "GraduationCap", "essential": False, "defaultKind": "expense", "builtin": True},
    {"id": "cat-subscriptions", "name": "Subscriptions", "icon": "Repeat", "essential": False, "defaultKind": "expense", "builtin": True},
    {"id": "cat-other", "name": "Other", "icon": "Shape", "essential": False, "defaultKind": "expense", "builtin": True},
]

DEFAULT_MEASUREMENT_TYPES = [
    {"id": "mt-weight", "name": "Weight", "unit": "kg", "builtin": True},
    {"id": "mt-bp-systolic", "name": "Blood pressure (systolic)", "unit": "mmHg", "builtin": True},
    {"id": "mt-bp-diastolic", "name": "Blood pressure (diastolic)", "unit": "mmHg", "builtin": True},
    {"id": "mt-resting-hr", "name": "Resting heart rate", "unit": "bpm", "builtin": True},
    {"id": "mt-glucose", "name": "Blood glucose", "unit": "mg/dL", "builtin": True},
]
