from typing import Literal, Self, Annotated
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, Field, model_validator

class GameStartResponse(BaseModel):
    id: UUID
    room_id: UUID
    state: str
    started_at: datetime

class InitialPeekResult(BaseModel):
    position: int
    value: int
    remaining_peek_count: int
    deadline_at: datetime

class InitialPeekCompleteResult(BaseModel):
    all_players_completed: bool

class InitialPeekTimeoutResult(BaseModel):
    status: Literal["Transitioned", "NotDue", "NotApplicable"]

class FaceDownCardView(BaseModel):
    position: int = Field(ge=0)
    face_up: Literal[False] = False

class FaceUpCardView(BaseModel):
    position: int = Field(ge=0)
    face_up: Literal[True] = True
    value: int = Field(ge=0, le=13)

CardView = FaceDownCardView | FaceUpCardView

class GamePlayerView(BaseModel):
    account_id: UUID
    username: str
    seat_index: Annotated[int, Field(ge=0, le=3)]
    hand_cards: list[CardView]
    initial_peek_completed: bool
    initial_peek_confirmed_positions: list[
        Annotated[int, Field(ge=0, le=3)]
    ] = Field(max_length=2)

class DrawPileView(BaseModel):
    card_count: int = Field(ge=0)

class DiscardPileView(BaseModel):
    card_count: int = Field(ge=0)
    top_card_value: Annotated[int, Field(ge=0, le=13)] | None

    @model_validator(mode="after")
    def validate_pile_state(self)->Self:
        if self.card_count == 0 and self.top_card_value is not None:
            raise ValueError(
                "Empty discard pile must have no top card"
            )
        
        if self.card_count != 0 and self.top_card_value is None:
            raise ValueError(
                "No-Empty discard pile must have a top card"
            )
        
        return self

class ActiveTurnView(BaseModel):
    id: UUID
    turn_number: int = Field(gt=0)
    acting_account_id: UUID
    started_at: datetime
    deadline_at: datetime

class GameView(BaseModel):
    id: UUID
    room_id: UUID
    state: str
    phase: str
    viewer_account_id: UUID
    players: list[GamePlayerView]
    draw_pile: DrawPileView
    discard_pile: DiscardPileView
    active_turn: ActiveTurnView | None
    initial_peek_deadline_at: datetime | None
    server_time: datetime
    schema_version: int = Field(ge=1)
    state_revision: int = Field(ge=0)

class InitialPeekCardView(BaseModel):
    position: int = Field(ge=0, le=3)
    value: int = Field(ge=0, le=13)

class InitialPeekPrivateView(BaseModel):
    game_session_id: UUID
    account_id: UUID

    revealed_cards: list[InitialPeekCardView] = Field(
        max_length=2
    )

    remaining_peek_count: int = Field(ge=0, le=2)

    deadline_at: datetime
    server_time: datetime