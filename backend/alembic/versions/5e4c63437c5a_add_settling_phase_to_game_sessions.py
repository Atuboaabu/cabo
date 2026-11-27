"""add settling phase to game sessions

Revision ID: 5e4c63437c5a
Revises: 1c1888f81430
Create Date: 2026-11-27 17:17:22.336284

Downgrade intentionally fails while any game_sessions row is still in
"Settling"; those rounds must be resolved before the phase can be removed.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '5e4c63437c5a'
down_revision: Union[str, Sequence[str], None] = '1c1888f81430'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_constraint(
        "ck_game_sessions_phase",
        "game_sessions",
        type_="check"
    )
    op.create_check_constraint(
        "ck_game_sessions_phase",
        "game_sessions",
        "phase IN ('InitialPeek', 'PlayerTurn', 'Settling')"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        "ck_game_sessions_phase",
        "game_sessions",
        type_="check"
    )
    op.create_check_constraint(
        "ck_game_sessions_phase",
        "game_sessions",
        "phase IN ('InitialPeek', 'PlayerTurn')"
    )
