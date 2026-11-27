from pydantic import BaseModel, Field, ConfigDict
from typing import Literal
from uuid import UUID

from app.schemas.game import (InitialPeekResult, InitialPeekCompleteResult,
                              DrawPilePrivateView, TakeFromDiscardPileResult)

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

class InitialPeekCompleteCommandOutcome(BaseModel):
    status: Literal[
        "Accepted",
        "Rejected",
        "NotYetDetermined",
        "IdentityConflict"
    ]
    replayed: bool
    reason: str | None = None
    complete_result: InitialPeekCompleteResult | None = None

class InitialPeekCompleteCommandRequest(BaseModel):
    request_id: UUID

class DrawPilePrivateViewCommandOutCome(BaseModel):
    status: Literal[
        "Accepted",
        "Rejected",
        "NotYetDetermined",
        "IdentityConflict"
    ]
    replayed: bool
    reason: str | None = None
    draw_pile_result: DrawPilePrivateView | None = None

class DrawPilePrivateViewCommandRequest(BaseModel):
    request_id: UUID

class TakeFromDiscardPileCommandOutcome(BaseModel):
    status: Literal[
        "Accepted",
        "Rejected",
        "NotYetDetermined",
        "IdentityConflict"
    ]
    replayed: bool
    reason: str | None = None
    discard_pile_result: TakeFromDiscardPileResult | None = None

class TakeFromDiscardPileCommandRequest(BaseModel):
    request_id: UUID

class SingleCardReplaceCommandOutcome(BaseModel):
    status: Literal[
        "Accepted",
        "Rejected",
        "NotYetDetermined",
        "IdentityConflict"
    ]
    replayed: bool
    reason: str | None = None

class SingleCardReplaceCommandRequest(BaseModel):
    request_id: UUID
    position: int = Field(ge=0)

class SingleCardReplaceCommandPayload(BaseModel):
    model_config = ConfigDict(
        strict=True,
        extra="forbid"
    )

    position: int = Field(ge=0)