from fastapi import APIRouter, status
from app.schemas import RoomResponse

from app.depencicies import SessionDep, ActiveUserDep, OriginCheckDep
from app.services import room

router = APIRouter(
    prefix="/rooms",
    tags=["rooms"]
)

@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=RoomResponse,
    dependencies=[OriginCheckDep]
)
def create_room(
    session: SessionDep,
    user: ActiveUserDep
):
    created_room = room.create_room(
        session,
        user
    )
    assert created_room is not None

    return RoomResponse(
        id=created_room.id,
        room_code=created_room.room_code,
        host_account_id=created_room.host_account_id,
        state=created_room.state
    )

@router.post(
    "/join",
    status_code=status.HTTP_201_CREATED,
    response_model=RoomResponse,
    dependencies=[OriginCheckDep]
)
def join_room(
    session: SessionDep,
    user: ActiveUserDep,
    room_code: str
):
    room_info = room.join_room(
        session,
        user,
        room_code
    )
    assert room_info is not None

    return RoomResponse(
        id=room_info.id,
        room_code=room_info.room_code,
        host_account_id=room_info.host_account_id,
        state=room_info.state
    )