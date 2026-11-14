import secrets
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy import select, func, update
from datetime import datetime, timezone

from app.models import UserAccount, Room, RoomMember
from app.schemas import ROOM_CODE_ALPHABET
from app.exc import exceptions

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
            raise exceptions.RoomCodeAllocationFailedException()

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

def join_room(
    session: Session,
    user_account: UserAccount,
    room_code: str
)->Room:
    try:
        statement = (
            select(Room).where(
                Room.room_code == room_code,
            ).with_for_update()
        )

        room = session.execute(
            statement
        ).scalar_one_or_none()

        if room is None:
            raise exceptions.RoomNotExistException()
        
        if room.state != "Lobby":
            raise exceptions.RoomStateNotLobbyException()
        
        used_seat_indexs = session.execute(
            select(RoomMember.seat_index).where(
                RoomMember.room_id == room.id,
                RoomMember.left_at.is_(None)
            )
        ).scalars().all()

        if len(used_seat_indexs) >= 4:
            raise exceptions.RoomIsFullException()
        
        for index in [0,1,2,3]:
            if index not in used_seat_indexs:
                seat_index = index
                break
        
        room_member = RoomMember(
            room_id = room.id,
            account_id = user_account.id,
            seat_index = seat_index,
            is_ready = False,
            joined_at = func.now()
        )

        session.add(room_member)
        session.commit()
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

def set_room_member_ready(
    session: Session,
    user_account: UserAccount,
    room_id: UUID,
    ready: bool
)->RoomMember:
    try:
        room = session.execute(
            select(Room).where(
                Room.id == room_id
            ).with_for_update()
        ).scalar_one_or_none()

        if room is None:
            raise exceptions.RoomNotExistException()
            
        if room.state != "Lobby":
            raise exceptions.RoomStateNotLobbyException()
        
        if user_account.id == room.host_account_id:
            raise exceptions.InvalidRequestException()

        room_member = session.execute(
            select(RoomMember).where(
                RoomMember.room_id == room.id,
                RoomMember.account_id == user_account.id,
                RoomMember.left_at.is_(None)
            )
        ).scalar_one_or_none()

        if room_member is None:
            raise exceptions.RequesterWrongException()
        
        room_member.is_ready = ready
        session.commit()
        session.refresh(room_member)
        return room_member
    except Exception:
        session.rollback()
        raise

def leave_room(
    session: Session,
    user_account: UserAccount,
    room_id: UUID,
)->None:
    try:
        room = session.execute(
            select(Room).where(
                Room.id == room_id
            ).with_for_update()
        ).scalar_one_or_none()

        if room is None:
            raise exceptions.RoomNotExistException()
            
        if room.state != "Lobby":
            raise exceptions.RoomStateNotLobbyException()

        room_member = session.execute(
            select(RoomMember).where(
                RoomMember.room_id == room.id,
                RoomMember.account_id == user_account.id,
                RoomMember.left_at.is_(None)
            )
        ).scalar_one_or_none()
        if room_member is None:
            raise exceptions.RequesterWrongException()

        if user_account.id == room.host_account_id:
            session.execute(
                update(RoomMember).where(
                    RoomMember.room_id == room.id,
                    RoomMember.left_at.is_(None)
                ).values(
                    left_at = func.now()
                )
            )
            room.state = "Closed"
        else:
            session.execute(
                update(RoomMember).where(
                    RoomMember.room_id == room.id,
                    RoomMember.account_id == user_account.id,
                    RoomMember.left_at.is_(None)
                ).values(
                    left_at = func.now()
                )
            )

        session.commit()
    except Exception:
        session.rollback()
        raise

def kick_room_member(
    session: Session,
    host_user: UserAccount,
    room_id: UUID,
    target_account_id: UUID
)->None:
    try:
        room = session.execute(
            select(Room).where(
                Room.id == room_id
            ).with_for_update()
        ).scalar_one_or_none()

        if room is None:
            raise exceptions.RoomNotExistException()

        if room.state != "Lobby":
            raise exceptions.RoomStateNotLobbyException()

        host_member = session.execute(
            select(RoomMember).where(
                RoomMember.room_id == room.id,
                RoomMember.account_id == host_user.id,
                RoomMember.left_at.is_(None)
            )
        ).scalar_one_or_none()
        if host_member is None:
            raise exceptions.RequesterWrongException()

        if room.host_account_id != host_user.id:
            raise exceptions.RequesterWrongException()

        if host_user.id == target_account_id:
            raise exceptions.InvalidRequestException()

        room_member = session.execute(
            select(RoomMember).where(
                RoomMember.room_id == room.id,
                RoomMember.account_id == target_account_id,
                RoomMember.left_at.is_(None)
            )
        ).scalar_one_or_none()
        if room_member is None:
            raise exceptions.TargetMemberNotExistException()

        session.execute(
            update(RoomMember).where(
                RoomMember.room_id == room.id,
                RoomMember.account_id == target_account_id,
                RoomMember.left_at.is_(None)
            ).values(
                left_at = func.now()
            )
        )

        session.commit()
    except Exception:
        session.rollback()
        raise
