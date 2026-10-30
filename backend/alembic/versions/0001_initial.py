"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-10-26 00:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("pk", sa.String(length=36), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("onboarded", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("pk"),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)

    op.create_table(
        "account_settings",
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("preferences", sa.JSON(), nullable=False),
        sa.Column("roast_settings", sa.JSON(), nullable=False),
        sa.Column("reminders", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.pk"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )

    op.create_table(
        "sessions",
        sa.Column("pk", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("csrf_token", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("user_agent", sa.String(length=400), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.pk"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("pk"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(op.f("ix_sessions_user_id"), "sessions", ["user_id"], unique=False)

    op.create_table(
        "auth_tokens",
        sa.Column("pk", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("purpose", sa.String(length=32), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.pk"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("pk"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(op.f("ix_auth_tokens_user_id"), "auth_tokens", ["user_id"], unique=False)
    op.create_index("ix_auth_tokens_user_purpose", "auth_tokens", ["user_id", "purpose"], unique=False)

    op.create_table(
        "records",
        sa.Column("pk", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("collection", sa.String(length=64), nullable=False),
        sa.Column("external_id", sa.String(length=120), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("month", sa.String(length=7), nullable=True),
        sa.Column("category_id", sa.String(length=120), nullable=True),
        sa.Column("event_key", sa.String(length=200), nullable=True),
        sa.Column("log_id", sa.String(length=120), nullable=True),
        sa.Column("type_id", sa.String(length=120), nullable=True),
        sa.Column("date", sa.String(length=10), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.pk"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("pk"),
        sa.UniqueConstraint("user_id", "collection", "external_id", name="uq_record_owner_ext"),
        sa.UniqueConstraint("user_id", "collection", "event_key", name="uq_record_event_key"),
    )
    op.create_index(op.f("ix_records_user_id"), "records", ["user_id"], unique=False)
    op.create_index("ix_record_user_coll", "records", ["user_id", "collection"], unique=False)
    op.create_index("ix_record_user_coll_month", "records", ["user_id", "collection", "month"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_record_user_coll_month", table_name="records")
    op.drop_index("ix_record_user_coll", table_name="records")
    op.drop_index(op.f("ix_records_user_id"), table_name="records")
    op.drop_table("records")
    op.drop_index("ix_auth_tokens_user_purpose", table_name="auth_tokens")
    op.drop_index(op.f("ix_auth_tokens_user_id"), table_name="auth_tokens")
    op.drop_table("auth_tokens")
    op.drop_index(op.f("ix_sessions_user_id"), table_name="sessions")
    op.drop_table("sessions")
    op.drop_table("account_settings")
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_table("users")
