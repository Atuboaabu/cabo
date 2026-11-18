from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import select
from datetime import datetime, timezone

from app.models import UserAccount, Room, RoomMember, GameSession, GamePlayer, GameCard
from app.exc import exceptions
from app.schemas import GameStartResponse
from app.database import engine
from app.services import auth
from app.game_logic import build_cabo_deck, shuffle_deck, deal_initial_cards, InitialDealResult

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
            ended_at=None,
            phase="InitialPeek"
        )
        session.add(game_session)
        session.flush()

        assert game_session.id is not None

        game_players_by_seat: dict[int, GamePlayer] = {}
        for member in members:
            game_player = GamePlayer(
                game_session_id=game_session.id,
                account_id=member.account_id,
                seat_index=member.seat_index,
            )
            session.add(game_player)
            game_players_by_seat[member.seat_index] = game_player
        session.flush()
        
        shuffled_card_values = shuffle_deck(build_cabo_deck())
        initial_deal_result = deal_initial_cards(
            shuffled_card_values,
            list(game_players_by_seat.keys())
        )

        hand_cards = (
            GameCard(
                game_session_id=game_session.id,
                value=card_value,
                location="Hand",
                owner_game_player_id=game_players_by_seat[seat_index].id,
                position=position
            )
            for seat_index, card_values in initial_deal_result.hands_by_seat.items()
            for position, card_value in enumerate(card_values)
        )
        session.add_all(hand_cards)

        first_discard_card = GameCard(
            game_session_id=game_session.id,
            value=initial_deal_result.first_discard,
            location="DiscardPile",
            owner_game_player_id=None,
            position=0
        )
        session.add(first_discard_card)

        draw_cards = (
            GameCard(
                game_session_id=game_session.id,
                value=card_value,
                location="DrawPile",
                owner_game_player_id=None,
                position=index
            )
            for index, card_value in enumerate(initial_deal_result.remaining_draw_pile)
        )
        session.add_all(draw_cards)

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