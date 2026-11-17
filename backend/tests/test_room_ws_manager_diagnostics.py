"""Minimal in-process Room WebSocket connection lifecycle regression tests.

No database, browser, session token or real user account is accessed here.
"""
import asyncio
from uuid import uuid4

from app.websocket.manager import RoomConnectionManager


class FakeWebSocket:
    def __init__(self):
        self.close_codes = []

    async def close(self, code):
        self.close_codes.append(code)


def test_kick_closes_only_registered_target_and_logs_counts(caplog):
    room_id, alice, bob = uuid4(), uuid4(), uuid4()
    manager = RoomConnectionManager()
    alice_ws, bob_ws = FakeWebSocket(), FakeWebSocket()

    async def exercise():
        await manager.connect(room_id, alice, alice_ws)
        await manager.connect(room_id, bob, bob_ws)
        assert await manager.authorize(room_id, alice_ws)
        assert await manager.authorize(room_id, bob_ws)
        await manager.account_disconnect(room_id, bob)

    with caplog.at_level("INFO", logger="app.websocket.manager"):
        asyncio.run(exercise())

    assert alice_ws.close_codes == []
    assert bob_ws.close_codes == [1008]
    assert len(manager.connections[room_id]) == 1
    assert "room_connections=2 matched=1" in caplog.text
    assert "attempted=1 failed=0" in caplog.text
    assert "room_ws authorized" in caplog.text


def test_kick_with_no_registered_connection_logs_zero(caplog):
    manager = RoomConnectionManager()
    room_id, bob = uuid4(), uuid4()
    with caplog.at_level("INFO", logger="app.websocket.manager"):
        asyncio.run(manager.account_disconnect(room_id, bob))
    assert "room_connections=0 matched=0" in caplog.text
    assert "attempted=0 failed=0" in caplog.text
