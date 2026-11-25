from uuid import UUID
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from logging import getLogger
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.services import game
from app.websocket.manager import game_manager

logger = getLogger(__name__)

router = APIRouter(
    prefix="/ws/games",
    tags=["game-websocket"]
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
    "/{game_session_id}"
)
async def room_websocket(
    websocket: WebSocket,
    game_session_id: UUID
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
        game.verify_game_ws_access,
        game_session_id,
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
        "Websocket accepted: game_session_id=%s", game_session_id
    )

    try:
        await game_manager.connect(
            game_session_id,
            account_id,
            websocket
        )

        current_account_id = await run_in_threadpool(
            game.verify_game_ws_access,
            game_session_id,
            session_token
        )
        if current_account_id != account_id:
            await websocket.close(code=1008)
            return
        
        if not await game_manager.authorize(game_session_id, websocket):
            await websocket.close(code=1008)
            return
    
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        logger.info(
            "Websocket disconnected: game_session_id=%s", game_session_id
        )
    finally:
        await game_manager.disconnect(
            game_session_id,
            websocket
        )