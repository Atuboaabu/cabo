import asyncio
from uuid import UUID
from fastapi import WebSocket

class RoomConnectionManager:
    def __init__(self) -> None:
        self.connections: dict[UUID, dict[WebSocket, UUID]] = {}

    def connect(
        self,
        room_id: UUID,
        account_id: UUID,
        websocket: WebSocket
    )->None:
        collections = self.connections.setdefault(room_id, {})
        collections[websocket] = account_id

    def disconnect(
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
    
    def account_disconnect(
        self,
        room_id: UUID,
        account_id: UUID
    )->None:
        connection_dict = self.connections.get(room_id)
        if connection_dict is None:
            return

        for (websocket, _account_id) in connection_dict.items():
            if _account_id == account_id:
                connection_dict.pop(websocket, None)

        if not connection_dict:
            self.connections.pop(room_id, None)
    
    def room_disconnect(
        self,
        room_id: UUID
    )->None:
        self.connections.pop(room_id, None)
    
    async def broadcast(
        self,
        room_id,
        message: dict
    )->None:
        connection_dict = self.connections.get(room_id)
        if connection_dict is None:
            return
        
        targets = list(connection_dict.items())
        
        results = await asyncio.gather(
            *(
                ws.send_json(message)
                for ws, _ in targets
            ),
            return_exceptions=True
        )

        for (ws, _), result in zip(targets, results):
            if isinstance(result, Exception):
                self.disconnect(
                    room_id,
                    ws
                )

manager = RoomConnectionManager()

    