from typing import Literal
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, Field

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
    value: int = Field(ge=0)

CardView = FaceDownCardView | FaceUpCardView

class GamePlayerView(BaseModel):
    account_id: UUID
    username: str
    seat_index: int = Field(ge=0)
    hand_cards: list[CardView]
    initial_peek_completed: bool
    initial_peek_positions: list[int]

class DrawPileView(BaseModel):
    card_count: int = Field(ge=0)

class DiscardPileView(BaseModel):
    card_count: int = Field(ge=0)
    top_card_value: int | None

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
    schema_version: int