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

    def connect(
        self,
        room_id: UUID,
        account_id: UUID,
        websocket: WebSocket
    )->None:
        collections = self.connections.setdefault(room_id, {})
        collections[websocket] = RoomConnection(
            account_id,
            False
        )
    
    def authorize(
        self,
        room_id: UUID,
        websocket: WebSocket
    )->bool:
        connection_dict = self.connections.get(room_id)
        if connection_dict is None:
            return False

        connection = connection_dict.get(websocket)
        if not connection:
            return False
        
        connection.authorized = True
        return True

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
    
    async def account_disconnect(
        self,
        room_id: UUID,
        account_id: UUID
    )->None:
        connection_dict = self.connections.get(room_id)
        if not connection_dict:
            return
        
        targets = [
            ws
            for ws, connection in connection_dict.items()
            if connection.account_id == account_id
        ]

        for ws in targets:
            self.disconnect(room_id, ws)

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
                ws.send_json(message)
                for ws in targets
            ),
            return_exceptions=True
        )

        for ws, result in zip(targets, results):
            if isinstance(result, Exception):
                self.disconnect(
                    room_id,
                    ws
                )

manager = RoomConnectionManager()

    