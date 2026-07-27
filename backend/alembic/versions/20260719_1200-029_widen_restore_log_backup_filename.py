"""Widen restore_log.backup_filename to fit uploaded archive names

Revision ID: 029
Revises: 028
Create Date: 2026-07-19 12:00:00.000000

The column was created as String(36) (UUID-sized), but uploaded archives are
logged with names like reknir_restore_upload_XXXXXXXX.tar.gz (37+ characters),
so the restore log insert failed with "value too long for type character
varying(36)" for every uploaded backup.
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "029"
down_revision = "028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "restore_log",
        "backup_filename",
        existing_type=sa.String(36),
        type_=sa.String(255),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "restore_log",
        "backup_filename",
        existing_type=sa.String(255),
        type_=sa.String(36),
        existing_nullable=False,
    )
