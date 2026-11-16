from uuid import UUID
from fastapi import APIRouter, WebSocket
from logging import getLogger

from app.config import settings
from app.depencicies import SessionDep
from app.services import auth

logger = getLogger(__name__)

router = APIRouter(
    prefix="/ws/rooms",
    tags="room-websoket"
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
    session: SessionDep,
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
    
    user = await auth.get_authenticated_account(
        session,
        session_token
    )

    if user is None:
        await reject_websocket(
            websocket,
            "Invalid session"
        )
        return
    
    await websocket.accept()
    logger.info(
        "Websocket accepted: room_id=%s", room_id
    )