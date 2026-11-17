from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.models import UserAccount, Room, RoomMember
from app.exc import exceptions

def validate_game_ready(
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
    
    members_id = (
        member.id
        for member in room_members
    )
    if host_user.id not in members_id:
        raise exceptions.RequesterWrongException()

    if len(room_members) <= 1 or len(room_members) >=4:
        raise exceptions.GamePlayerCountInvalidException()
    
    all_members_ready = all(
        member.is_ready
        for member in room_members
        if member.account_id != host_user.id
    )
    if not all_members_ready:
        raise exceptions.GameMembersNotReadyException()
    
    return (room, list(room_members))