import asyncio
import os
from logging import getLogger
from uuid import UUID
from fastapi import WebSocket

from dataclasses import dataclass

logger = getLogger(__name__)

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
            logger.info(
                "room_ws registered room_id=%s pid=%d connections=%d",
                room_id, os.getpid(), len(self.connections[room_id])
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
            logger.info(
                "room_ws authorized room_id=%s pid=%d connections=%d",
                room_id, os.getpid(), len(connection_dict)
            )
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
            connection_dict = self.connections.get(room_id, {})
            before_count = len(connection_dict)
            targets = [
                ws
                for ws, connection in connection_dict.items()
                if connection.account_id == account_id
            ]
            for ws in targets:
                self._disconnect_unlocked(room_id, ws)

        logger.info(
            "room_ws kick_disconnect room_id=%s pid=%d room_connections=%d matched=%d",
            room_id, os.getpid(), before_count, len(targets)
        )
        results = await asyncio.gather(
            *(ws.close(code=1008) for ws in targets),
            return_exceptions=True
        )
        logger.info(
            "room_ws kick_close_result room_id=%s pid=%d attempted=%d failed=%d",
            room_id, os.getpid(), len(targets),
            sum(isinstance(result, Exception) for result in results)
        )

    async def room_disconnect(
        self,
        room_id: UUID
    )->None:
        lock = self.get_room_lock(room_id)
        async with lock:
            connection_dict = self.connections.pop(room_id, {})
            targets = list(connection_dict.keys())

        logger.info(
            "room_ws room_disconnect room_id=%s pid=%d targets=%d",
            room_id, os.getpid(), len(targets)
        )
        results = await asyncio.gather(
            *(ws.close(code=1008) for ws in targets),
            return_exceptions=True
        )
        logger.info(
            "room_ws room_close_result room_id=%s pid=%d attempted=%d failed=%d",
            room_id, os.getpid(), len(targets),
            sum(isinstance(result, Exception) for result in results)
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

            failed_connections: list[WebSocket] = []
            for ws, result in zip(targets, results):
                if isinstance(result, Exception):
                    self._disconnect_unlocked(
                        room_id,
                        ws
                    )
                    failed_connections.append(ws)
        
        await asyncio.gather(
            *(
                conn.close(code=1008)
                for conn in failed_connections
            ),
            return_exceptions=True
        )

@dataclass
class GameConnection:
    account_id: UUID
    authorized: bool = False

class GameConnectionManager:
    def __init__(self) -> None:
        self.connections: dict[UUID, dict[WebSocket, GameConnection]] = {}
        self.game_locks: dict[UUID, asyncio.Lock] = {}
        self._SEND_TIMEOUT_SECONDS = 2
    
    def get_game_lock(
        self,
        game_session_id: UUID
    )->asyncio.Lock:
        return self.game_locks.setdefault(
            game_session_id,
            asyncio.Lock(),
        )

    async def connect(
        self,
        game_session_id: UUID,
        account_id: UUID,
        websocket: WebSocket
    )->None:
        lock = self.get_game_lock(game_session_id)
        async with lock:
            self.connections.setdefault(game_session_id, {})[websocket] = (
                GameConnection(
                    account_id,
                    False
                )
            )
            logger.info(
                "game_ws registered game_session_id=%s pid=%d connections=%d",
                game_session_id, os.getpid(), len(self.connections[game_session_id])
            )

    async def authorize(
        self,
        game_session_id: UUID,
        websocket: WebSocket
    )->bool:
        lock = self.get_game_lock(game_session_id)
        async with lock:
            connection_dict = self.connections.get(game_session_id)
            if connection_dict is None:
                return False

            connection = connection_dict.get(websocket)
            if not connection:
                return False
            
            connection.authorized = True
            logger.info(
                "game_ws authorized game_session_id=%s pid=%d connections=%d",
                game_session_id, os.getpid(), len(connection_dict)
            )
            return True

    def _disconnect_unlocked(
        self,
        game_session_id: UUID,
        websocket: WebSocket
    )->None:
        connection_dict = self.connections.get(game_session_id)
        if connection_dict is None:
            return

        connection_dict.pop(websocket, None)

        if not connection_dict:
            self.connections.pop(game_session_id, None)
    
    async def disconnect(
        self,
        game_session_id: UUID,
        websocket: WebSocket
    )->None:
        lock = self.get_game_lock(game_session_id)
        async with lock:
            self._disconnect_unlocked(
                game_session_id,
                websocket
            )
    
    async def account_disconnect(
        self,
        game_session_id: UUID,
        account_id: UUID
    )->None:
        lock = self.get_game_lock(game_session_id)
        async with lock:
            connection_dict = self.connections.get(game_session_id, {})
            before_count = len(connection_dict)
            targets = [
                ws
                for ws, connection in connection_dict.items()
                if connection.account_id == account_id
            ]
            for ws in targets:
                self._disconnect_unlocked(game_session_id, ws)

        logger.info(
            "game_ws disconnect game_session_id=%s pid=%d room_connections=%d matched=%d",
            game_session_id, os.getpid(), before_count, len(targets)
        )
        results = await asyncio.gather(
            *(ws.close(code=1008) for ws in targets),
            return_exceptions=True
        )
        logger.info(
            "game_ws game_session_id room_id=%s pid=%d attempted=%d failed=%d",
            game_session_id, os.getpid(), len(targets),
            sum(isinstance(result, Exception) for result in results)
        )

    async def game_disconnect(
        self,
        game_session_id: UUID
    )->None:
        lock = self.get_game_lock(game_session_id)
        async with lock:
            connection_dict = self.connections.pop(game_session_id, {})
            targets = list(connection_dict.keys())

        logger.info(
            "game_ws disconnect game_session_id=%s pid=%d targets=%d",
            game_session_id, os.getpid(), len(targets)
        )
        results = await asyncio.gather(
            *(ws.close(code=1008) for ws in targets),
            return_exceptions=True
        )
        logger.info(
            "game_ws room_close_result game_session_id=%s pid=%d attempted=%d failed=%d",
            game_session_id, os.getpid(), len(targets),
            sum(isinstance(result, Exception) for result in results)
        )

    async def broadcast(
        self,
        game_session_id,
        message: dict
    )->None:
        lock = self.get_game_lock(game_session_id)
        async with lock:
            connection_dict = self.connections.get(game_session_id)
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

            failed_connections: list[WebSocket] = []
            for ws, result in zip(targets, results):
                if isinstance(result, Exception):
                    self._disconnect_unlocked(
                        game_session_id,
                        ws
                    )
                    failed_connections.append(ws)
        
        await asyncio.gather(
            *(
                conn.close(code=1008)
                for conn in failed_connections
            ),
            return_exceptions=True
        )

room_manager = RoomConnectionManager()
game_manager = GameConnectionManager()
    