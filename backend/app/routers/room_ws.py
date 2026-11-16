from uuid import UUID
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from logging import getLogger
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.depencicies import SessionDep
from app.services import room

logger = getLogger(__name__)

router = APIRouter(
    prefix="/ws/rooms",
    tags=["room-websocket"]
)

async def reject_websocket(
    websocket: WebSocket,
    message: str
):
    logger.info(
        "WebSocket rejected: %s", message
    )
    await websocket.close()

@router.websocket(
    "/{room_id}"
)
async def room_websocket(
    websocket: WebSocket,
    room_id: UUID
)->None:
    origin = websocket.headers.get("origin")
    if origin not in settings.allowed_origins:
        await reject_websocket(
            websocket,
            "Invalid origin"
        )
        return
    
    session_token = websocket.cookies.get(
        "session_token"
    )
    if not session_token:
        await reject_websocket(
            websocket,
            "Missing session"
        )
        return
    
    account_id = await run_in_threadpool(
        room.verify_room_ws_access,
        room_id,
        session_token
    )
    if account_id is None:
        await reject_websocket(
            websocket,
            "Invalid session"
        )
        return
    
    await websocket.accept()
    logger.info(
        "Websocket accepted: room_id=%s", room_id
    )

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        logger.info(
            "Websocket disconnected: room_id=%s", room_id
        )