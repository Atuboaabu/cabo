import uuid
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy import String, DateTime, CheckConstraint, UniqueConstraint
from datetime import datetime

from app.database import Base

class LoginRateLimit(Base):
    __tablename__ = "login_rate_limits"

    __table_args__ = (
        UniqueConstraint(
            "scope",
            "subject_digest",
            name="uq_login_rate_limits_scope_subject_digest"
        ),
        CheckConstraint(
            "attempt_count>=0",
            name="ck_login_rate_limits_attempt_count_nonnegative"
        )
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    scope: Mapped[str] = mapped_column(
        String(20),
        nullable=False
    )

    subject_digest: Mapped[str] = mapped_column(
        String(64),
        nullable=False
    )

    window_started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    attempt_count: Mapped[int] = mapped_column(
        default=0,
        nullable=False
    )