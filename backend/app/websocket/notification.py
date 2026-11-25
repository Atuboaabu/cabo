from uuid import UUID
from logging import getLogger

from app.websocket.manager import game_manager

logger = getLogger(__name__)

async def notification_room_changed(
    room_id: UUID
)->None:
    try:
        await game_manager.broadcast(
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