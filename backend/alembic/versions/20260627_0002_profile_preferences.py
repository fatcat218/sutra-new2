"""Add account preferences and deletion request metadata.

Revision ID: 20260627_0002
Revises: 20260627_0001
Create Date: 2026-06-27
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260627_0002"
down_revision: Union[str, None] = "20260627_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "profiles",
        sa.Column(
            "language_preference",
            sa.String(length=16),
            server_default="en",
            nullable=False,
        ),
    )
    op.add_column(
        "profiles",
        sa.Column("deletion_requested_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("profiles", "deletion_requested_at")
    op.drop_column("profiles", "language_preference")
