from uuid import UUID
from fastapi import APIRouter, status
from app.schemas import (RoomResponse, RoomJoinRequest, RoomReadyResponse, RoomReadyRequest,
                         RoomView)

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
    status_code=status.HTTP_200_OK,
    response_model=RoomResponse,
    dependencies=[OriginCheckDep]
)
def join_room(
    session: SessionDep,
    user: ActiveUserDep,
    join_request: RoomJoinRequest
):
    room_info = room.join_room(
        session,
        user,
        join_request.room_code
    )
    assert room_info is not None

    return RoomResponse(
        id=room_info.id,
        room_code=room_info.room_code,
        host_account_id=room_info.host_account_id,
        state=room_info.state
    )

@router.put(
    "/{room_id}/ready",
    status_code=status.HTTP_200_OK,
    response_model=RoomReadyResponse,
    dependencies=[OriginCheckDep]
)
def roommember_set_ready(
    session: SessionDep,
    user: ActiveUserDep,
    room_id: UUID,
    ready_request: RoomReadyRequest
):
    room_member = room.set_room_member_ready(
        session,
        user,
        room_id,
        ready_request.ready
    )

    return RoomReadyResponse(
        account_id=room_member.account_id,
        is_ready=room_member.is_ready
    )

@router.post(
    "/{room_id}/leave",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[OriginCheckDep]
)
def room_member_leave(
    session: SessionDep,
    user: ActiveUserDep,
    room_id: UUID
):
    room.leave_room(
        session,
        user,
        room_id
    )

@router.post(
    "/{room_id}/members/{target_account_id}/kick",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[OriginCheckDep]
)
def kick_room_member(
    session: SessionDep,
    user: ActiveUserDep,
    room_id: UUID,
    target_account_id: UUID
):
    room.kick_room_member(
        session,
        user,
        room_id,
        target_account_id
    )

@router.post(
    "/{room_id}/disband",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[OriginCheckDep]
)
def disband_room(
    session: SessionDep,
    user: ActiveUserDep,
    room_id: UUID
):
    room.disband_room(
        session,
        user,
        room_id
    )

@router.get(
    "/{room_id}",
    status_code=status.HTTP_200_OK,
    response_model=RoomView,
    dependencies=[OriginCheckDep]
)
def get_room_info(
    session: SessionDep,
    user: ActiveUserDep,
    room_id: UUID
):
    return room.get_room_info(
        session,
        user,
        room_id
    )