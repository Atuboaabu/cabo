from uuid import UUID
from datetime import datetime
from pydantic import BaseModel

class GameStartResponse(BaseModel):
    id: UUID
    room_id: UUID
    state: str
    started_at: datetime