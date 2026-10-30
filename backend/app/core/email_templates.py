"""Branded, email-client-safe HTML + plain-text bodies for auth emails.

Deep-navy background, lime primary action, accessible contrast, no remote
images and no tracking pixels. Every message also carries a plain-text
alternative and the raw verification/reset URL for clients that strip HTML.
"""
from __future__ import annotations

from dataclasses import dataclass

_BRAND = "Personal Life Tracker"


@dataclass(frozen=True)
class EmailContent:
    subject: str
    text: str
    html: str


def _shell(intro_lines: list[str], cta_label: str, cta_url: str, expiry_line: str, safety_line: str) -> str:
    intro_html = "".join(f"<p>{line}</p>" for line in intro_lines)
    return f"""\
<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{_BRAND}</title></head>
<body style="margin:0;padding:0;background:#0B1120;">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#F2F5FC;">
    <div style="text-align:center;margin-bottom:24px;">
      <span style="display:inline-block;width:40px;height:40px;line-height:40px;border-radius:12px;background:#B7F774;color:#0B1120;font-weight:800;font-size:20px;">P</span>
      <div style="margin-top:8px;font-weight:700;font-size:16px;letter-spacing:.2px;">{_BRAND}</div>
    </div>
    <div style="background:#101827;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:28px 24px;">
      {intro_html}
      <p style="margin:28px 0;text-align:center;">
        <a href="{cta_url}" style="display:inline-block;background:#B7F774;color:#0B1120;font-weight:700;text-decoration:none;padding:13px 26px;border-radius:12px;">{cta_label}</a>
      </p>
      <p style="font-size:13px;color:#9AA8BD;word-break:break-all;">
        If the button doesn&rsquo;t work, copy this link into your browser:<br>{cta_url}
      </p>
      <p style="font-size:13px;color:#9AA8BD;margin-bottom:0;">{expiry_line}</p>
    </div>
    <p style="font-size:12px;color:#6B7A90;text-align:center;margin-top:20px;">{safety_line}</p>
  </div>
</body></html>"""


def _text(intro_lines: list[str], cta_url: str, expiry_line: str, safety_line: str) -> str:
    body = "\n\n".join(intro_lines)
    return f"{body}\n\n{cta_url}\n\n{expiry_line}\n\n{safety_line}\n"


def verification_email(link: str, ttl_minutes: int) -> EmailContent:
    intro = [
        f"Welcome to {_BRAND}.",
        "Please verify your email address to activate your account and securely "
        "access your personal finance and health tracker.",
        "Select the button below to verify your email address.",
    ]
    expiry = f"This link expires in {ttl_minutes // 60 if ttl_minutes >= 60 else ttl_minutes} " \
             f"{'hour' if ttl_minutes >= 60 and ttl_minutes % 3600 == 0 else ('hours' if ttl_minutes >= 60 else 'minutes')}."
    safety = "If you did not create this account, you can safely ignore this email."
    return EmailContent(
        subject=f"Verify your {_BRAND} account",
        text=_text(intro, link, expiry, safety),
        html=_shell(intro, "Verify email address", link, expiry, safety),
    )


def reset_email(link: str, ttl_minutes: int) -> EmailContent:
    intro = [
        "We received a request to reset your password.",
        "Use the button below to choose a new password. This link can be used only once.",
    ]
    expiry = f"For your security, this link expires in {ttl_minutes} minutes."
    safety = "If you didn't request a password reset, you can ignore this email — your current password stays unchanged."
    return EmailContent(
        subject=f"Reset your {_BRAND} password",
        text=_text(intro, link, expiry, safety),
        html=_shell(intro, "Reset password", link, expiry, safety),
    )
