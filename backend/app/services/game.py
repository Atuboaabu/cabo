from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import select
from datetime import datetime, timezone

from app.models import UserAccount, Room, RoomMember, GameSession
from app.exc import exceptions
from app.schemas import GameStartResponse
from app.database import engine
from app.services import auth

def validate_start_game(
    session: Session,
    host_user: UserAccount,
    room_id: UUID
)->tuple[Room, list[RoomMember]]:
    room = session.execute(
        select(Room).where(Room.id == room_id).with_for_update()
    ).scalar_one_or_none()

    if room is None:
        raise exceptions.RoomNotExistException()
    
    if room.state != "Lobby":
        raise exceptions.RoomStateNotLobbyException()
    
    room_members = session.execute(
        select(RoomMember).where(
            RoomMember.room_id == room_id,
            RoomMember.left_at.is_(None)
        )
    ).scalars().all()

    if host_user.id != room.host_account_id:
        raise exceptions.RequesterWrongException()
    
    if not any(
        member.account_id == host_user.id
        for member in room_members
    ):
        raise exceptions.RequesterWrongException()

    if not 2 <= len(room_members) <= 4:
        raise exceptions.GamePlayerCountInvalidException()
    
    all_members_ready = all(
        member.is_ready
        for member in room_members
        if member.account_id != host_user.id
    )
    if not all_members_ready:
        raise exceptions.GameMembersNotReadyException()
    
    return (room, list(room_members))

def start_game(
    session: Session,
    host_user: UserAccount,
    room_id: UUID
)->GameSession:
    try:
        room, members = validate_start_game(
            session,
            host_user,
            room_id
        )
        room.state = "Playing"

        now = datetime.now(timezone.utc)
        game_session = GameSession(
            room_id=room.id,
            state="Playing",
            started_at=now,
            ended_at=None
        )
        session.add(game_session)
        session.commit()
        return game_session
    except Exception:
        session.rollback()
        raise

def execute_start_game(
    token: str,
    room_id: UUID
)->GameStartResponse:
    with Session(engine) as session:
        user = auth.get_authenticated_account(
            session,
            token
        )

        game_session = start_game(
            session,
            user,
            room_id
        )

        return GameStartResponse(
            id=game_session.id,
            room_id=game_session.room_id,
            state=game_session.state,
            started_at=game_session.started_at
        )