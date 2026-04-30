"""add supplier payment fields

Revision ID: 028
Revises: 027
Create Date: 2026-04-30 12:00:00.000000

"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "028"
down_revision = "027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add structured payment fields (reuse existing paymenttype enum)
    op.add_column(
        "suppliers",
        sa.Column("payment_type", sa.Enum("bankgiro", "plusgiro", "bank_account", name="paymenttype"), nullable=True),
    )
    op.add_column("suppliers", sa.Column("bankgiro_number", sa.String(20), nullable=True))
    op.add_column("suppliers", sa.Column("plusgiro_number", sa.String(20), nullable=True))
    op.add_column("suppliers", sa.Column("clearing_number", sa.String(10), nullable=True))
    op.add_column("suppliers", sa.Column("account_number", sa.String(20), nullable=True))
    op.add_column("suppliers", sa.Column("iban", sa.String(34), nullable=True))
    op.add_column("suppliers", sa.Column("bic", sa.String(11), nullable=True))

    # Migrate existing data: bank_account -> account_number
    op.execute(
        "UPDATE suppliers SET account_number = bank_account, "
        "payment_type = 'bank_account' "
        "WHERE bank_account IS NOT NULL AND bank_account != ''"
    )

    # Remove old columns
    op.drop_column("suppliers", "bank_account")
    op.drop_column("suppliers", "bank_name")


def downgrade() -> None:
    # Recreate old columns
    op.add_column("suppliers", sa.Column("bank_name", sa.String(), nullable=True))
    op.add_column("suppliers", sa.Column("bank_account", sa.String(), nullable=True))

    # Migrate data back
    op.execute("UPDATE suppliers SET bank_account = account_number WHERE account_number IS NOT NULL")

    # Remove new columns
    op.drop_column("suppliers", "bic")
    op.drop_column("suppliers", "iban")
    op.drop_column("suppliers", "account_number")
    op.drop_column("suppliers", "clearing_number")
    op.drop_column("suppliers", "plusgiro_number")
    op.drop_column("suppliers", "bankgiro_number")
    op.drop_column("suppliers", "payment_type")
