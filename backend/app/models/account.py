import uuid
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy import String, DateTime, func
from datetime import datetime

from app.database import Base

class UserAccount(Base):
    __tablename__ = "user_accounts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    username: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    normalized_username: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        unique=True,
    )

    email: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    normalized_email: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        unique=True,
    )

    hashed_password: Mapped[str] = mapped_column(
        nullable=False
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )