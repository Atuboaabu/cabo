from sqlalchemy.orm import Session
from datetime import datetime, timezone

from app.models import UserAccount, Room, RoomMember
from app.security.verification import generate_code

def create_room(
    session: Session,
    user_account: UserAccount
)-> Room:
    
    room_code = generate_code(8)
    now = datetime.now(timezone.utc)
    try:
        room = Room(
            room_code = room_code,
            host_account_id = user_account.id,
            state = "Lobby",
        )
        session.add(room)
        session.flush()

        assert room.id is not None

        room_member = RoomMember(
            room_id = room.id,
            account_id = user_account.id,
            seat_index = 0,
            is_ready = False,
            joined_at = now,
        )
        session.add(room_member)
        session.flush()
        session.commit()
        return room
    except Exception:
        session.rollback()
        raise