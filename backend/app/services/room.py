import secrets
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from datetime import datetime, timezone

from app.models import UserAccount, Room, RoomMember
from app.exc import exceptions

ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

def generate_room_code() -> str:
    return "".join(
        secrets.choice(ROOM_CODE_ALPHABET)
        for _ in range(6)
    )

def create_room(
    session: Session,
    user_account: UserAccount
)-> Room:
    try:
        for _  in range(5):
            room_code = generate_room_code()
            statement = (
                insert(Room).values(
                    room_code = room_code,
                    host_account_id = user_account.id,
                    state = "Lobby",
                ).on_conflict_do_nothing(
                    index_elements=[Room.room_code],
                ).returning(
                    Room.id
                )
            )
            room_id = session.execute(
                statement
            ).scalar_one_or_none()
            if room_id is not None:
                break
        if room_id is None:
            raise exceptions.RoomCodeConfilictException()

        now = datetime.now(timezone.utc)
        room_member = RoomMember(
            room_id = room_id,
            account_id = user_account.id,
            seat_index = 0,
            is_ready = False,
            joined_at = now,
        )
        session.add(room_member)
        session.flush()
        session.commit()

        room = session.get(Room, room_id)
        assert room is not None

        return room
    except IntegrityError as exc:
        session.rollback()
        if getattr(exc.orig, "sqlstate", None) == "23505":
            constraint_name = exc.orig.diag.constraint_name

            if constraint_name == "uq_room_members_active_account":
                raise exceptions.AccountAlreadyInRoomException() from exc
        raise
    except Exception:
        session.rollback()
        raise