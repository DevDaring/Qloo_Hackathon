"""read-only shared sample projects

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-09
"""
from alembic import op
import sqlalchemy as sa

revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('projects', sa.Column('locked', sa.Boolean(), server_default=sa.false(), nullable=False))
    # the seeded jury sample becomes read-only so one visitor cannot change what the next one sees
    op.execute("UPDATE projects SET locked = true WHERE is_demo")


def downgrade() -> None:
    op.drop_column('projects', 'locked')
