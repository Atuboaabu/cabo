import uuid

from pydantic import BaseModel, Field, field_validator

ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

class RoomResponse(BaseModel):
    id: uuid.UUID
    room_code: str
    host_account_id: uuid.UUID
    state: str

class RoomJoinRequest(BaseModel):
    room_code: str = Field(
        min_length=6,
        max_length=6,
        pattern=f"^[{ROOM_CODE_ALPHABET}]+$"
    )

    @field_validator("room_code", mode="before")
    @classmethod
    def normalize_room_code(cls, value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("房间码必须是字符串")

        return value.upper()

class RoomReadyRequest(BaseModel):
    ready: bool

class RoomReadyResponse(BaseModel):
    account_id: uuid.UUID
    is_ready: bool

class RoomMemberView(BaseModel):
    account_id: uuid.UUID
    username: str
    seat_index: int
    is_ready: bool
    is_host: bool

class RoomView(BaseModel):
    id: uuid.UUID
    room_code: str
    state: str
    host_account_id: uuid.UUID
    members: list[RoomMemberView]