import uuid

from pydantic import BaseModel

class RoomResponse(BaseModel):
    id: uuid.UUID
    room_code: str
    host_account_id: uuid.UUID
    state: str
