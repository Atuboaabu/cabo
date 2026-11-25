from uuid import UUID
from logging import getLogger

from app.websocket.manager import room_manager

logger = getLogger(__name__)

async def notification_room_changed(
    room_id: UUID
)->None:
    try:
        await room_manager.broadcast(
            room_id,
            {
                "type": "room.changed",
                "room_id": str(room_id)
            }
        )
    except Exception:
        logger.exception(
            "Room notification changed failed: room id = %s",
            room_id
        )
    
async def notification_game_changed(
    game_session_id: UUID
)->None:
    try:
        await room_manager.broadcast(
            game_session_id,
            {
                "type": "game.changed",
                "game_session_id": str(game_session_id)
            }
        )
    except Exception:
        logger.exception(
            "Game notification changed failed: game session id = %s",
            game_session_id
        )