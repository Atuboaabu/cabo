import secrets
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy import select, func, update
from datetime import datetime, timezone

from app.models import UserAccount, Room, RoomMember
from app.schemas import (ROOM_CODE_ALPHABET, RoomMemberView, RoomView,
                         RoomResponse, RoomReadyResponse)
from app.exc import exceptions
from app.services import auth
from app.database import engine

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

def execute_join_room(
    token: str,
    room_code: str
)->RoomResponse:
    with Session(engine) as session:
        user = auth.get_authenticated_account(
            session,
            token
        )
        
        room_info = join_room(
            session,
            user,
            room_code
        )

        return RoomResponse(
            id=room_info.id,
            room_code=room_info.room_code,
            host_account_id=room_info.host_account_id,
            state=room_info.state
        )

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

def execute_set_room_member_ready(
    token: str,
    room_id: UUID,
    ready: bool
)->RoomReadyResponse:
    with Session(engine) as session:
        user = auth.get_authenticated_account(
            session,
            token
        )

        room_member = set_room_member_ready(
            session,
            user,
            room_id,
            ready
        )

        return RoomReadyResponse(
            account_id=room_member.account_id,
            is_ready=room_member.is_ready
        )

def _close_room(
    session: Session,
    room: Room
)->None:
    session.execute(
        update(RoomMember).where(
            RoomMember.room_id == room.id,
            RoomMember.left_at.is_(None)
        ).values(
            left_at = func.now()
        )
    )
    room.state = "Closed"

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
            _close_room(session, room)
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

def execute_leave_room(
    token: str,
    room_id: UUID,
)->UUID:
    with Session(engine) as session:
        user = auth.get_authenticated_account(
            session,
            token
        )

        leave_room(
            session,
            user,
            room_id
        )

        return user.id

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

def execute_kick_room_member(
    token: str,
    room_id: UUID,
    target_account_id: UUID
)->None:
    with Session(engine) as session:
        user = auth.get_authenticated_account(
            session,
            token
        )

        kick_room_member(
            session,
            user,
            room_id,
            target_account_id
        )

def disband_room(
    session: Session,
    host_user: UserAccount,
    room_id: UUID
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

        _close_room(session, room)

        session.commit()
    except Exception:
        session.rollback()
        raise

def execute_disband_room(
    token: str,
    room_id: UUID
)->None:
    with Session(engine) as session:
        user = auth.get_authenticated_account(
            session,
            token
        )

        disband_room(
            session,
            user,
            room_id
        )

def get_room_info(
    session: Session,
    user_account: UserAccount,
    room_id: UUID
)->RoomView:
    room = session.get(Room, room_id)
    if room is None:
        raise exceptions.RoomNotExistException()

    room_member = session.execute(
        select(RoomMember).where(
            RoomMember.room_id == room.id,
            RoomMember.account_id == user_account.id,
            RoomMember.left_at.is_(None)
        )
    ).scalar_one_or_none()
    if room_member is None:
        raise exceptions.RequesterWrongException()

    members_info = session.execute(
        select(
            RoomMember.account_id,
            UserAccount.username,
            RoomMember.seat_index,
            RoomMember.is_ready
        ).join(
            UserAccount,
            RoomMember.account_id == UserAccount.id
        ).where(
            RoomMember.room_id == room_id,
            RoomMember.left_at.is_(None)
        ).order_by(
            RoomMember.seat_index
        )
    ).mappings().all()

    return RoomView(
        id=room.id,
        room_code=room.room_code,
        state=room.state,
        host_account_id=room.host_account_id,
        members=[
            RoomMemberView(
                account_id=member_info.account_id,
                username=member_info.username,
                seat_index=member_info.seat_index,
                is_ready=member_info.is_ready,
                is_host=(member_info.account_id == room.host_account_id)
            )
            for member_info in members_info
        ]
    )

def verify_room_subscription_permission(
    session: Session,
    account_id: UUID,
    room_id: UUID
)->bool:
    authorized_account_id = session.execute(
        select(RoomMember.account_id).join(
            Room,
            RoomMember.room_id == Room.id,
        ).where(
            Room.id == room_id,
            Room.state == "Lobby",
            RoomMember.account_id == account_id,
            RoomMember.left_at.is_(None),
        )
    ).scalar_one_or_none()
    return authorized_account_id is not None

def verify_room_ws_access(
    room_id: UUID,
    token: str
)->UUID|None:
    with Session(engine) as session:
        try:
            user = auth.get_authenticated_account(
                session,
                token
            )
        except exceptions.InvalidCookieException:
            return None
        
        allowed = verify_room_subscription_permission(
            session,
            user.id,
            room_id
        )
        if not allowed:
            return None
        else:
            return user.id
