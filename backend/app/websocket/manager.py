import asyncio
from uuid import UUID
from fastapi import WebSocket
from collections import defaultdict

class RoomConnectionManager:
    def __init__(self) -> None:
        self.connections: dict[UUID, dict[WebSocket, UUID]] = defaultdict()

    def connect(
        self,
        room_id: UUID,
        account_id: UUID,
        websocket: WebSocket
    )->None:
        self.connections[room_id][websocket] = account_id

    def disconnect(
        self,
        room_id: UUID,
        account_id: UUID,
        websocket: WebSocket
    )->None:
        connection_dict = self.connections.get(room_id)
        if connection_dict is None:
            return
        
        account = connection_dict.get(websocket)
        if account is None:
            return
        
        connection_dict.pop(websocket)
    
    async def broadcast(
        self,
        room_id,
        message: dict
    )->None:
        connection_dict = self.connections.get(room_id)
        if connection_dict is None:
            return
        
        results = await asyncio.gather(
            *(
                ws.send_json(message)
                for ws in connection_dict.keys()
            ),
            return_exceptions=True
        )

        for ws, account_id, result in zip(connection_dict.keys(), connection_dict.values(), results):
            if isinstance(result, Exception):
                self.disconnect(
                    room_id,
                    account_id,
                    ws
                )

manager = RoomConnectionManager()

    