from pydantic import BaseModel, Field, ConfigDict
from typing import Literal
from uuid import UUID

from app.schemas.game import InitialPeekResult

class InitialPeekCommandPayload(BaseModel):
    model_config = ConfigDict(
        strict=True,
        extra="forbid"
    )

    position: int = Field(ge=0, le=3)

class InitialPeekCommandOutcome(BaseModel):
    status: Literal[
        "Accepted",
        "Rejected",
        "NotYetDetermined",
        "IdentityConflict"
    ]

    replayed: bool
    reason: str | None = None
    peek_result: InitialPeekResult | None = None

class InitialPeekCommandRequest(BaseModel):
    request_id: UUID
    position: int = Field(ge=0, le=3)