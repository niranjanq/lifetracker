"""Email provider abstraction: SMTP/Mailpit and Resend adapters, dispatch, and
honest failure. Network is never touched — the transport is monkey-patched.
"""
from __future__ import annotations

import pytest

from app.core import mail
from app.core.mail import EmailDeliveryError, send_email


# --------------------------------------------------------------------------- #
# SMTP / Mailpit adapter
# --------------------------------------------------------------------------- #
class _FakeSMTP:
    last: "_FakeSMTP | None" = None

    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs
        self.sent = None
        self.tls = False
        self.login_as = None
        _FakeSMTP.last = self

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def starttls(self):
        self.tls = True

    def login(self, user, pwd):
        self.login_as = (user, pwd)

    def send_message(self, msg):
        self.sent = msg


def test_smtp_sends_multipart_with_html(monkeypatch):
    monkeypatch.setattr(mail.settings, "EMAIL_PROVIDER", "mailpit")
    monkeypatch.setattr(mail.settings, "EMAIL_FROM", "PLT <no-reply@example.com>")
    monkeypatch.setattr(mail.smtplib, "SMTP", _FakeSMTP)

    send_email("user@example.com", "Subject", "plain body", "<p>html body</p>")

    sent = _FakeSMTP.last.sent
    assert sent["From"] == "PLT <no-reply@example.com>"
    assert sent["To"] == "user@example.com"
    assert sent["Subject"] == "Subject"
    # text + html alternative → multipart
    assert sent.get_content_type() == "multipart/alternative"
    parts = [p.get_content_type() for p in sent.iter_parts()]
    assert "text/plain" in parts and "text/html" in parts


def test_smtp_failure_raises_delivery_error(monkeypatch):
    def boom(*a, **k):
        raise OSError("connection refused")

    monkeypatch.setattr(mail.settings, "EMAIL_PROVIDER", "smtp")
    monkeypatch.setattr(mail.smtplib, "SMTP", boom)

    with pytest.raises(EmailDeliveryError):
        send_email("user@example.com", "S", "text")


# --------------------------------------------------------------------------- #
# Resend adapter
# --------------------------------------------------------------------------- #
class _Resp:
    def __init__(self, status_code=200, body=None):
        self.status_code = status_code
        self._body = body if body is not None else {"id": "email-123"}

    def json(self):
        return self._body


def test_resend_posts_correct_request(monkeypatch):
    captured: dict = {}

    def fake_post(url, json=None, headers=None, timeout=None):
        captured.update(url=url, json=json, headers=headers, timeout=timeout)
        return _Resp(200)

    monkeypatch.setattr(mail.settings, "EMAIL_PROVIDER", "resend")
    monkeypatch.setattr(mail.settings, "RESEND_API_KEY", "re_secret_key")
    monkeypatch.setattr(mail.settings, "EMAIL_FROM", "PLT <verify@example.com>")
    monkeypatch.setattr(mail.httpx, "post", fake_post)

    send_email("user@example.com", "Verify", "text body", "<p>html</p>")

    assert captured["url"] == "https://api.resend.com/emails"
    assert captured["headers"]["Authorization"] == "Bearer re_secret_key"
    assert captured["json"]["from"] == "PLT <verify@example.com>"
    assert captured["json"]["to"] == ["user@example.com"]
    assert captured["json"]["subject"] == "Verify"
    assert captured["json"]["text"] == "text body"
    assert captured["json"]["html"] == "<p>html</p>"


def test_resend_missing_key_raises(monkeypatch):
    monkeypatch.setattr(mail.settings, "EMAIL_PROVIDER", "resend")
    monkeypatch.setattr(mail.settings, "RESEND_API_KEY", "")
    with pytest.raises(EmailDeliveryError):
        send_email("user@example.com", "S", "text")


def test_resend_non_2xx_raises(monkeypatch):
    monkeypatch.setattr(mail.settings, "EMAIL_PROVIDER", "resend")
    monkeypatch.setattr(mail.settings, "RESEND_API_KEY", "re_x")
    monkeypatch.setattr(mail.httpx, "post", lambda *a, **k: _Resp(422, {"name": "validation_error"}))
    with pytest.raises(EmailDeliveryError):
        send_email("user@example.com", "S", "text")


def test_resend_network_error_raises(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("dns failure")

    monkeypatch.setattr(mail.settings, "EMAIL_PROVIDER", "resend")
    monkeypatch.setattr(mail.settings, "RESEND_API_KEY", "re_x")
    monkeypatch.setattr(mail.httpx, "post", boom)
    with pytest.raises(EmailDeliveryError):
        send_email("user@example.com", "S", "text")
