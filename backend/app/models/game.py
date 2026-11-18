import uuid
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import ForeignKey, String, func, DateTime, CheckConstraint, Index, text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from datetime import datetime

from app.database import Base


class GameSession(Base):
    __tablename__ = "game_sessions"
    __table_args__ = (
        CheckConstraint(
            "state IN ('Starting', 'Playing', 'Finished', 'Aborted')",
            name="ck_game_sessions_state"
        ),
        Index(
            "uq_game_sessions_room_id",
            "room_id",
            unique=True,
            postgresql_where=text("state IN ('Starting', 'Playing')")
        ),
        CheckConstraint(
            "phase IN ('InitialPeek', 'PlayerTurn')"
        )
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        default=uuid.uuid4,
        primary_key=True
    )

    room_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("rooms.id"),
        nullable=False
    )

    state: Mapped[str] = mapped_column(
        String(20),
        nullable=False
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )

    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )

    ended_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )

    phase: Mapped[str] = mapped_column(
        String(20),
        nullable=False
    )

class GamePlayer(Base):
    __tablename__ = "game_players"
    __table_args__ = (
        CheckConstraint(
            "seat_index >= 0 AND seat_index <= 3",
            name="ck_game_players_seat_index_inrange"
        ),
        UniqueConstraint(
            "game_session_id",
            "account_id",
            name="uq_game_players_game_session_id_account_id"
        ),
        UniqueConstraint(
            "game_session_id",
            "seat_index",
            name="uq_game_players_game_session_id_seat_index"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        default=uuid.uuid4,
        primary_key=True
    )

    game_session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("game_sessions.id"),
        nullable=False
    )

    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user_accounts.id"),
        nullable=False
    )

    seat_index: Mapped[int] = mapped_column(
        nullable=False
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )

    initial_peek_completed: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
        server_default=text("false")
    )

class GameCard(Base):
    __tablename__="game_cards"
    __table_args__=(
        CheckConstraint(
            "value >=0 AND value <= 13",
            name="ck_game_cards_value_inrange"
        ),
        CheckConstraint(
            "location IN ('DrawPile', 'DiscardPile', 'Hand')",
            name="ck_game_cards_location_valid"
        ),
        CheckConstraint(
            "position >= 0",
            name="ck_game_cards_position_nonnegative"
        ),
        CheckConstraint(
            """
            (location = 'Hand' AND owner_game_player_id IS NOT NULL)
            OR
            (location <> 'Hand' AND owner_game_player_id IS NULL)
            """,
            name="ck_game_cards_owner_game_player_id_valid"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        default=uuid.uuid4,
        primary_key=True
    )

    game_session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("game_sessions.id"),
        nullable=False
    )

    value: Mapped[int] = mapped_column(
        nullable=False
    )

    location: Mapped[str] = mapped_column(
        String(20),
        nullable=False
    )

    owner_game_player_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("game_players.id"),
        nullable=True
    )

    position: Mapped[int] = mapped_column(
        nullable=False
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )