import asyncio
from uuid import UUID
from fastapi import WebSocket

from dataclasses import dataclass

@dataclass
class RoomConnection:
    account_id: UUID
    authorized: bool = False

class RoomConnectionManager:
    def __init__(self) -> None:
        self.connections: dict[UUID, dict[WebSocket, RoomConnection]] = {}
        self.room_locks: dict[UUID, asyncio.Lock] = {}
        self._SEND_TIMEOUT_SECONDS = 2
    
    def get_room_lock(
        self,
        room_id: UUID
    )->asyncio.Lock:
        return self.room_locks.setdefault(
            room_id,
            asyncio.Lock(),
        )

    async def connect(
        self,
        room_id: UUID,
        account_id: UUID,
        websocket: WebSocket
    )->None:
        lock = self.get_room_lock(room_id)
        async with lock:
            self.connections.setdefault(room_id, {})[websocket] = (
                RoomConnection(
                    account_id,
                    False
                )
            )

    async def authorize(
        self,
        room_id: UUID,
        websocket: WebSocket
    )->bool:
        lock = self.get_room_lock(room_id)
        async with lock:
            connection_dict = self.connections.get(room_id)
            if connection_dict is None:
                return False

            connection = connection_dict.get(websocket)
            if not connection:
                return False
            
            connection.authorized = True
            return True

    def _disconnect_unlocked(
        self,
        room_id: UUID,
        websocket: WebSocket
    )->None:
        connection_dict = self.connections.get(room_id)
        if connection_dict is None:
            return

        connection_dict.pop(websocket, None)

        if not connection_dict:
            self.connections.pop(room_id, None)
    
    async def disconnect(
        self,
        room_id: UUID,
        websocket: WebSocket
    )->None:
        lock = self.get_room_lock(room_id)
        async with lock:
            self._disconnect_unlocked(
                room_id,
                websocket
            )
    
    async def account_disconnect(
        self,
        room_id: UUID,
        account_id: UUID
    )->None:
        lock = self.get_room_lock(room_id)
        async with lock:
            connection_dict = self.connections.get(room_id)
            if not connection_dict:
                return
        
            targets = [
                ws
                for ws, connection in connection_dict.items()
                if connection.account_id == account_id
            ]

            for ws in targets:
                self._disconnect_unlocked(room_id, ws)

        await asyncio.gather(
            *(
                ws.close(code=1008)
                for ws in targets
            ),
            return_exceptions=True
        )
    
    async def room_disconnect(
        self,
        room_id: UUID
    )->None:
        lock = self.get_room_lock(room_id)
        async with lock:
            connection_dict = self.connections.pop(room_id, {})
            targets = list(connection_dict.keys())

        await asyncio.gather(
            *(
                ws.close(code=1008)
                for ws in targets
            ),
            return_exceptions=True
        )
    
    async def broadcast(
        self,
        room_id,
        message: dict
    )->None:
        lock = self.get_room_lock(room_id)
        async with lock:
            connection_dict = self.connections.get(room_id)
            if connection_dict is None:
                return
        
            targets = list(
                ws
                for ws, connection in connection_dict.items()
                if connection.authorized
            )
            
            results = await asyncio.gather(
                *(
                    asyncio.wait_for(
                        ws.send_json(message),
                        timeout=self._SEND_TIMEOUT_SECONDS
                    )
                    for ws in targets
                ),
                return_exceptions=True
            )

            for ws, result in zip(targets, results):
                if isinstance(result, Exception):
                    self._disconnect_unlocked(
                        room_id,
                        ws
                    )

manager = RoomConnectionManager()

    