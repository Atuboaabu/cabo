import uuid
from datetime import datetime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy import ForeignKey, String, DateTime, func, UniqueConstraint, CheckConstraint

from app.database import Base


class Room(Base):
    __tablename__ = "rooms"
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )

    room_code: Mapped[str] = mapped_column(
        nullable=False,
        unique=True
    )

    host_account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user_accounts.id"),
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

class RoomMember(Base):
    __tablename__ = "room_members"
    __table_args__ = (
        CheckConstraint(
            "seat_index >= 0 AND seat_index <= 3",
            name="ck_room_members_seat_index_inrange"
        )
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )

    room_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("rooms.id"),
        nullable=False
    )

    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user_accounts.id"),
        nullable=False
    )
    
    seat_index: Mapped[int] = mapped_column(
        nullable=False
    )

    is_ready: Mapped[bool] = mapped_column(
        nullable=False
    )

    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False
    )

    left_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
