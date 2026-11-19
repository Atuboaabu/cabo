from typing import Literal
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel

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