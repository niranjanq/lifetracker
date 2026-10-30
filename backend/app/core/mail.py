"""Email delivery behind a single provider-agnostic interface.

Two adapters are supported, selected by ``settings.EMAIL_PROVIDER``:

* ``mailpit`` / ``smtp`` — plain SMTP with an optional STARTTLS. Local
  development points this at Mailpit (a mailbox catcher whose UI is at
  http://localhost:8025); a real SMTP relay can be used instead.
* ``resend`` — the Resend HTTPS API (``POST https://api.resend.com/emails``),
  preferred for real inboxes because some hosts block outbound SMTP.

Deliberately RAISES :class:`EmailDeliveryError` on any failure so callers can
never falsely claim an email was sent. The API only ever confirms that the
provider *accepted* the send request — it is not a promise of inbox delivery.
"""
from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

import httpx

from .config import settings

log = logging.getLogger("app.mail")

_RESEND_URL = "https://api.resend.com/emails"


class EmailDeliveryError(RuntimeError):
    """Raised when an email could not be handed off to the configured provider."""


def send_email(to: str, subject: str, text: str, html: str | None = None) -> None:
    """Dispatch to the configured provider. Raises EmailDeliveryError on failure."""
    provider = (settings.EMAIL_PROVIDER or "mailpit").lower()
    if provider == "resend":
        _send_resend(to, subject, text, html)
    else:
        _send_smtp(to, subject, text, html)


def _send_smtp(to: str, subject: str, text: str, html: str | None) -> None:
    msg = EmailMessage()
    msg["From"] = settings.EMAIL_FROM
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")
    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as smtp:
            if settings.SMTP_USE_TLS:
                smtp.starttls()
            if settings.SMTP_USER:
                smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            smtp.send_message(msg)
    except Exception as exc:  # noqa: BLE001 - surface any transport error honestly
        raise EmailDeliveryError(f"SMTP delivery failed: {exc}") from exc


def _send_resend(to: str, subject: str, text: str, html: str | None) -> None:
    if not settings.RESEND_API_KEY:
        raise EmailDeliveryError("EMAIL_PROVIDER=resend but RESEND_API_KEY is not configured")
    payload: dict[str, object] = {
        "from": settings.EMAIL_FROM,
        "to": [to],
        "subject": subject,
        "text": text,
    }
    if html:
        payload["html"] = html
    headers = {
        "Authorization": f"Bearer {settings.RESEND_API_KEY}",
        "Content-Type": "application/json",
    }
    try:
        resp = httpx.post(_RESEND_URL, json=payload, headers=headers, timeout=10)
    except Exception as exc:  # noqa: BLE001 - network / transport failure
        raise EmailDeliveryError("Resend request could not be completed") from exc
    if resp.status_code >= 400:
        # Log only the provider request id (never the API key or token).
        request_id = ""
        try:
            request_id = str(resp.json().get("name", ""))
        except Exception:  # noqa: BLE001
            pass
        raise EmailDeliveryError(
            f"Resend rejected the send ({resp.status_code}{(' ' + request_id) if request_id else ''})"
        )
