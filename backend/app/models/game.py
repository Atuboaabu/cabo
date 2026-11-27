import uuid
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import (ForeignKey, String, func, DateTime,
                        CheckConstraint, Index, text,
                        UniqueConstraint, Boolean)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from datetime import datetime
from typing import Any

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
            "phase IN ('InitialPeek', 'PlayerTurn')",
            name="ck_game_sessions_phase"
        ),
        CheckConstraint(
            "state_revision >= 0",
            name="ck_game_sessions_state_revision_nonnegative"
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

    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )

    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )

    phase: Mapped[str] = mapped_column(
        String(20),
        nullable=False
    )

    initial_peek_deadline_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )

    state_revision: Mapped[int] = mapped_column(
        server_default=text("0"),
        nullable=False,
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
        CheckConstraint(
            "initial_peek_1st_card_id IS NOT NULL "
            "OR initial_peek_2nd_card_id IS NULL",
            name="ck_game_players_peek_card_valid"
        ),
        CheckConstraint(
            "initial_peek_1st_card_id <> initial_peek_2nd_card_id",
            name="ck_game_players_peek_distinct"
        )
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

    initial_peek_1st_card_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "game_cards.id",
            name="fk_game_players_initial_peek_1st_card_id",
            use_alter=True
        ),
        nullable=True
    )

    initial_peek_2nd_card_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "game_cards.id",
            name="fk_game_players_initial_peek_2nd_card_id",
            use_alter=True
        ),
        nullable=True
    )

class GameCard(Base):
    __tablename__="game_cards"
    __table_args__=(
        CheckConstraint(
            "value >=0 AND value <= 13",
            name="ck_game_cards_value_inrange"
        ),
        CheckConstraint(
            "location IN ('DrawPile', 'PendingAction', 'DiscardPile', 'Hand')",
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
        CheckConstraint(
            "(location = 'DiscardPile' AND face_up = TRUE) OR " \
            "(location = 'DrawPile' AND face_up = FALSE) OR " \
            "(location IN ('PendingAction', 'Hand'))",
            name="ck_game_cards_face_up_valid"
        )
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

    owner_game_player_id: Mapped[uuid.UUID | None] = mapped_column(
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

    face_up: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False
    )

class GameTurn(Base):
    __tablename__ = "game_turns"
    __table_args__ = (
        CheckConstraint(
            "turn_number >= 1",
            name="ck_game_turns_turn_number_positive"
        ),
        UniqueConstraint(
            "game_session_id",
            "turn_number",
            name="uq_game_turns_turn_number_in_game_session"
        ),
        CheckConstraint(
            "state IN ('AwaitingAction', 'AwaitingCardDecision', 'Completed', 'Aborted')",
            name="ck_game_turns_state_inrange"
        ),
        CheckConstraint(
            "(state IN ('AwaitingAction', 'AwaitingCardDecision') AND ended_at IS NULL) "
            "OR "
            "(state IN ('Completed', 'Aborted') AND ended_at IS NOT NULL)",
            name="ck_game_turns_state_valid"
        ),
        CheckConstraint(
            "(started_at < deadline_at) AND (ended_at IS NULL OR ended_at >= started_at)",
            name="ck_game_turns_timestamp_valid"
        ),
        Index(
            "uq_game_turns_game_session_id",
            "game_session_id",
            unique=True,
            postgresql_where=text("ended_at IS NULL")
        ),
        CheckConstraint(
            "main_card_source IS NULL OR " \
            "main_card_source IN ('DrawPile', 'DiscardPile')",
            name="ck_game_turns_main_card_source_valid"
        ),
        CheckConstraint(
            "(state = 'AwaitingAction' AND " \
            "main_card_id IS NULL AND " \
            "main_card_source IS NULL) OR " \
            "(state <> 'AwaitingAction')",
            name="ck_game_turns_main_card_info_null_in_awaitingaction"
        ),
        CheckConstraint(
            "(state = 'AwaitingCardDecision' AND " \
            "main_card_id IS NOT NULL AND " \
            "main_card_source IS NOT NULL) OR " \
            "(state <> 'AwaitingCardDecision')",
            name="ck_game_turns_main_card_info_notnull_in_awaitingcarddecision"
        )
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        default=uuid.uuid4,
        primary_key=True,
    )

    game_session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("game_sessions.id"),
        nullable=False
    )

    game_player_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("game_players.id"),
        nullable=False
    )

    turn_number: Mapped[int] = mapped_column(
        nullable=False
    )

    state: Mapped[str] = mapped_column(
        String(20),
        nullable=False
    )

    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False
    )

    deadline_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )

    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )

    main_card_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "game_cards.id",
            name="fk_game_turns_main_card_id"),
        nullable=True
    )

    main_card_source: Mapped[str | None] = mapped_column(
        String(20),
        nullable=True
    )

class GameCommandRequest(Base):
    __tablename__ = "game_command_requests"
    __table_args__ = (
        UniqueConstraint(
            "game_session_id",
            "account_id",
            "request_id",
            name="uq_game_command_requests_identity"
        ),
        CheckConstraint(
            "status IN ('Pending', 'Accepted', 'Rejected')",
            name="ck_game_command_requests_status"
        ),
        CheckConstraint(
            "(status = 'Pending' And decided_at IS NULL) OR "
            "(status IN ('Accepted', 'Rejected') AND decided_at IS NOT NULL)",
            name="ck_game_command_requests_decided_at"
        )
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )

    game_session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("game_sessions.id"),
        nullable=False
    )

    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user_accounts.id"),
        nullable=False
    )

    request_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        nullable=False
    )

    command_type: Mapped[str] = mapped_column(
        String(64),
        nullable=False
    )

    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="Pending"
    )

    request_payload: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
    )

    result_payload: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )

    decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )