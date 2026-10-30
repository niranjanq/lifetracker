"""google / firebase auth: users.firebase_uid + nullable password_hash

Revision ID: 0003_google_auth
Revises: 0002_chatbot
Create Date: 2026-10-29 00:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0003_google_auth"
down_revision = "0002_chatbot"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # batch_alter_table keeps this portable: SQLite recreates the table to change
    # column nullability, PostgreSQL issues a plain ALTER.
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("firebase_uid", sa.String(length=128), nullable=True))
        batch.alter_column(
            "password_hash", existing_type=sa.Text(), nullable=True,
            existing_server_default=sa.text(""), server_default=None,
        )
    # Unique index matches the ORM (unique=True, index=True). Multiple NULLs are
    # permitted, so unlinked legacy accounts are unaffected.
    op.create_index("ix_users_firebase_uid", "users", ["firebase_uid"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_firebase_uid", table_name="users")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("firebase_uid")
        batch.alter_column("password_hash", existing_type=sa.Text(), nullable=False)
