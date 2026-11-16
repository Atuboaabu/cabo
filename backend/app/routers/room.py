from uuid import UUID
from fastapi import APIRouter, status, Request
from starlette.concurrency import run_in_threadpool

from app.schemas import (RoomResponse, RoomJoinRequest, RoomReadyResponse, RoomReadyRequest,
                         RoomView)

from app.depencicies import SessionDep, ActiveUserDep, OriginCheckDep
from app.services import room
from app.websocket.manager import manager
from app.exc import exceptions

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
async def join_room(
    request: Request,
    join_request: RoomJoinRequest
):
    token = request.cookies.get("session_token")
    if not token:
        raise exceptions.InvalidCookieException()

    response = await run_in_threadpool(
        room.execute_join_room,
        token,
        join_request.room_code
    )

    await manager.broadcast(
        response.id,
        {
            "type": "room.changed",
            "room_id": str(response.id)
        }
    )

    return response

@router.put(
    "/{room_id}/ready",
    status_code=status.HTTP_200_OK,
    response_model=RoomReadyResponse,
    dependencies=[OriginCheckDep]
)
async def roommember_set_ready(
    request: Request,
    room_id: UUID,
    ready_request: RoomReadyRequest
):
    token = request.cookies.get("session_token")
    if not token:
        raise exceptions.InvalidCookieException()

    response = await run_in_threadpool(
        room.execute_set_room_member_ready,
        token,
        room_id,
        ready_request.ready
    )

    await manager.broadcast(
        room_id,
        {
            "type": "room.changed",
            "room_id": str(room_id)
        }
    )

    return response

@router.post(
    "/{room_id}/leave",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[OriginCheckDep]
)
async def room_member_leave(
    request: Request,
    room_id: UUID
):
    token = request.cookies.get("session_token")
    if not token:
        raise exceptions.InvalidCookieException()

    account_id = await run_in_threadpool(
        room.execute_leave_room,
        token,
        room_id
    )

    manager.account_disconnect(
        room_id,
        account_id
    )

    await manager.broadcast(
        room_id,
        {
            "type": "room.changed",
            "room_id": str(room_id)
        }
    )

@router.post(
    "/{room_id}/members/{target_account_id}/kick",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[OriginCheckDep]
)
async def kick_room_member(
    request: Request,
    room_id: UUID,
    target_account_id: UUID
):
    token = request.cookies.get("session_token")
    if not token:
        raise exceptions.InvalidCookieException()

    await run_in_threadpool(
        room.execute_kick_room_member,
        token,
        room_id,
        target_account_id
    )

    manager.account_disconnect(
        room_id,
        target_account_id
    )

    await manager.broadcast(
        room_id,
        {
            "type": "room.changed",
            "room_id": str(room_id)
        }
    )

@router.post(
    "/{room_id}/disband",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[OriginCheckDep]
)
async def disband_room(
    request: Request,
    room_id: UUID
):
    token = request.cookies.get("session_token")
    if not token:
        raise exceptions.InvalidCookieException()

    await run_in_threadpool(
        room.execute_disband_room,
        token,
        room_id
    )

    await manager.broadcast(
        room_id,
        {
            "type": "room.changed",
            "room_id": str(room_id)
        }
    )

@router.get(
    "/{room_id}",
    status_code=status.HTTP_200_OK,
    response_model=RoomView
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