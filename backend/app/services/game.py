from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import select, exists, update, func
from datetime import datetime, timezone, timedelta
import random

from app.models import (UserAccount, Room, RoomMember,
                        GameSession, GamePlayer, GameCard,
                        GameTurn)
from app.exc import exceptions
from app.schemas import (GameStartResponse, InitialPeekResult,
                         InitialPeekCompleteResult, InitialPeekTimeoutResult,
                         GamePlayerView, GameView, FaceDownCardView,
                         DrawPileView, DiscardPileView,
                         ActiveTurnView)
from app.database import engine
from app.services import auth
from app.game_logic import (build_cabo_deck, shuffle_deck, deal_initial_cards,
                            INITIAL_PEEK_DURATION_SECONDS, TURN_DURATION_SECONDS)

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
            phase="InitialPeek",
            initial_peek_deadline_at=None
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
        session.flush()

        game_session.initial_peek_deadline_at = (
            datetime.now(timezone.utc) +
            timedelta(seconds=INITIAL_PEEK_DURATION_SECONDS)
        )

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

def _get_locked_game_session(
    session: Session,
    game_session_id: UUID
)->GameSession | None:
    game_session = session.execute(
        select(GameSession).where(
            GameSession.id == game_session_id
        ).with_for_update()
    ).scalar_one_or_none()
    return game_session

def _get_locked_game_context(
    session: Session,
    user_account: UserAccount,
    game_session_id: UUID
)->tuple[GameSession, GamePlayer]:
    game_session = _get_locked_game_session(
        session,
        game_session_id
    )

    game_player = session.execute(
        select(GamePlayer).where(
            GamePlayer.game_session_id == game_session_id,
            GamePlayer.account_id == user_account.id
        )
    ).scalar_one_or_none()

    if (game_session is None
        or game_player is None):
        raise exceptions.GameNotAccessibleException()
    
    if game_session.ended_at is not None:
        raise exceptions.GameAlreadyEndedException()
    
    return game_session, game_player

def initial_peek(
    session: Session,
    user_account: UserAccount,
    game_session_id: UUID,
    position: int
)-> InitialPeekResult:
    try:
        game_session, game_player = _get_locked_game_context(
            session,
            user_account,
            game_session_id
        )
        
        if not (game_session.state == "Playing" 
                and game_session.phase == "InitialPeek"
            ):
            raise exceptions.InvalidGameStateException()
        
        if game_player.initial_peek_completed:
            raise exceptions.InitialPeekCompletedException()
        
        game_card = session.execute(
            select(GameCard).where(
                GameCard.game_session_id == game_session.id,
                GameCard.owner_game_player_id == game_player.id,
                GameCard.location == "Hand",
                GameCard.position == position,
            )
        ).scalar_one_or_none()
        if game_card is None:
            raise exceptions.InvalidPeekTargetException(position)
        
        if (game_player.initial_peek_1st_card_id == game_card.id 
            or game_player.initial_peek_2nd_card_id == game_card.id
        ):
            raise exceptions.RepeatedPeekException(position)

        if not (game_session.initial_peek_deadline_at is not None
            and game_session.initial_peek_deadline_at > datetime.now(timezone.utc)
        ):
            raise exceptions.InitialPeekExpiredException()

        if game_player.initial_peek_1st_card_id is None:
            game_player.initial_peek_1st_card_id = game_card.id
            remaining_peek_count=1
        elif game_player.initial_peek_2nd_card_id is None:
            game_player.initial_peek_2nd_card_id = game_card.id
            remaining_peek_count=0
        else:
            raise exceptions.InitialPeekCountExceedException()
        
        result = InitialPeekResult(
            position=position,
            value=game_card.value,
            remaining_peek_count=remaining_peek_count,
            deadline_at=game_session.initial_peek_deadline_at,
        )

        session.commit()

        return result
    except Exception:
        session.rollback()
        raise

def _create_first_game_turn(
    session: Session,
    game_session: GameSession
)->GameTurn:
    if not (game_session.state == "Playing" 
        and game_session.phase == "InitialPeek"
    ):
        raise exceptions.InvalidGameStateException()

    players = session.execute(
        select(GamePlayer).where(
            GamePlayer.game_session_id == game_session.id
        )
    ).scalars().all()

    if not 2 <= len(players) <= 4:
        raise exceptions.GamePlayerCountInvalidException()

    if not all(
        player.initial_peek_completed
        for player in players
    ):
        raise exceptions.InitialPeekNotCompletedException()
    
    turn_created = session.execute(
        select(
            exists().where(
                GameTurn.game_session_id == game_session.id,
            )
        )
    ).scalar_one()
    if turn_created:
        raise exceptions.GameTurnAlreadyCreatedException()
    
    first_player = random.choice(players)
    now=datetime.now(timezone.utc)
    first_game_turn = GameTurn(
        game_session_id=game_session.id,
        game_player_id=first_player.id,
        turn_number=1,
        state="AwaitingAction",
        started_at=now,
        deadline_at=now+timedelta(seconds=TURN_DURATION_SECONDS),
        ended_at=None
    )
    session.add(first_game_turn)
    session.flush()
    return first_game_turn

def _transition_to_player_turn(
    session: Session,
    game_session: GameSession
)->GameTurn:
    first_game_turn = _create_first_game_turn(
        session,
        game_session
    )

    game_session.phase = "PlayerTurn"
    session.flush()

    return first_game_turn


def complete_initial_peek(
    session: Session,
    user_account: UserAccount,
    game_session_id: UUID
)->InitialPeekCompleteResult:
    try:
        game_session, game_player = _get_locked_game_context(
            session,
            user_account,
            game_session_id
        )

        if not (game_session.state == "Playing" 
            and game_session.phase == "InitialPeek"
        ):
            raise exceptions.InvalidGameStateException()
        
        if game_player.initial_peek_completed:
            raise exceptions.InitialPeekCompletedException()
        
        if not (game_session.initial_peek_deadline_at is not None
            and game_session.initial_peek_deadline_at > datetime.now(timezone.utc)
        ):
            raise exceptions.InitialPeekExpiredException()
        
        game_player.initial_peek_completed = True
        session.flush()

        has_uncompleted_players = session.execute(
            select(
                exists().where(
                    GamePlayer.game_session_id == game_session_id,
                    GamePlayer.initial_peek_completed == False
                )
            )
        ).scalar_one()

        result = InitialPeekCompleteResult(
            all_players_completed = not has_uncompleted_players
        )

        if not has_uncompleted_players:
            _transition_to_player_turn(
                session,
                game_session
            )

        session.commit()

        return result
    except Exception:
        session.rollback()
        raise

def expire_initial_peek(
    session: Session,
    game_session_id: UUID
)->InitialPeekTimeoutResult:
    try:
        game_session = _get_locked_game_session(
            session,
            game_session_id
        )

        now = datetime.now(timezone.utc)

        if (game_session is None
            or game_session.ended_at is not None
            or game_session.state != "Playing"
            or game_session.phase != "InitialPeek"
        ):
            result = InitialPeekTimeoutResult(status="NotApplicable")
        elif game_session.initial_peek_deadline_at is None:
            raise exceptions.InvalidGameStateException()
        elif game_session.initial_peek_deadline_at > now:
            result = InitialPeekTimeoutResult(status="NotDue")
        else:
            session.execute(
                update(GamePlayer).where(
                    GamePlayer.game_session_id == game_session_id,
                    GamePlayer.initial_peek_completed.is_(False)
                ).values(
                    initial_peek_completed=True
                )
            )

            _transition_to_player_turn(
                session,
                game_session
            )
            result = InitialPeekTimeoutResult(status="Transitioned")

        session.commit()
        return result
    except Exception:
        session.rollback()
        raise

def get_game_view(
    session: Session,
    user_account: UserAccount,
    game_session_id: UUID,
)->GameView:
    try:
        game_session, viewer = _get_locked_game_context(
            session,
            user_account,
            game_session_id
        )

        players_info = session.execute(
            select(
                GamePlayer,
                UserAccount.username,
            ).join(
                UserAccount,
                GamePlayer.account_id == UserAccount.id
            ).where(
                GamePlayer.game_session_id == game_session_id
            ).order_by(
                GamePlayer.seat_index
            )
        ).all()

        if not 2 <= len(players_info) <= 4:
            raise exceptions.GamePlayerCountInvalidException()
        
        players_by_id = {
            player.id: player
            for player, _ in players_info
        }
        players_hand_cards = session.execute(
            select(
                GameCard,
                GamePlayer.id
            ).join(
                GamePlayer,
                GameCard.owner_game_player_id == GamePlayer.id
            ).where(
                GameCard.game_session_id == game_session_id,
                GameCard.location == "Hand",
                GameCard.owner_game_player_id.in_(list(players_by_id.keys()))
            ).order_by(
                GameCard.position
            )
        ).all()

        players_views = [
            GamePlayerView(
                account_id=game_player.account_id,
                username=username,
                seat_index=game_player.seat_index,
                hand_cards=[
                    FaceDownCardView(
                        position=game_card.position,
                        face_up=False
                    )
                    for game_card, player_id in players_hand_cards
                    if game_player.id == player_id
                ],
                initial_peek_completed=game_player.initial_peek_completed,
                initial_peek_confirmed_positions=[
                    game_card.position
                    for game_card, player_id in players_hand_cards
                    for card_id in [
                        game_player.initial_peek_1st_card_id,
                        game_player.initial_peek_2nd_card_id
                    ]
                    if (game_session.phase == "InitialPeek"
                        and game_player.id == player_id
                        and card_id is not None
                        and game_card.id == card_id)
                ]
            )
            for game_player, username in players_info
        ]

        draw_pile_card_count = session.execute(
            select(func.count()).where(
                GameCard.game_session_id == game_session_id,
                GameCard.location == "DrawPile"
            ).select_from(
                GameCard
            )
        ).scalar_one()
        draw_pile_view = DrawPileView(card_count=draw_pile_card_count)

        discard_top_card_value = session.execute(
            select(GameCard.value).where(
                GameCard.game_session_id == game_session_id,
                GameCard.location == "DiscardPile"
            ).order_by(
                GameCard.position.desc()
            ).limit(1)
        ).scalar_one_or_none()
        discard_pile_count = session.execute(
            select(func.count()).where(
                GameCard.game_session_id == game_session_id,
                GameCard.location == "DiscardPile"
            ).select_from(
                GameCard
            )
        ).scalar_one()

        discard_pile_view = DiscardPileView(
            card_count=discard_pile_count,
            top_card_value=discard_top_card_value
        )
        
        active_turn_view: ActiveTurnView | None = None
        game_turn = session.execute(
            select(GameTurn).where(
                GameTurn.game_session_id==game_session_id,
                GameTurn.ended_at.is_(None)
            )
        ).scalar_one_or_none()

        if game_session.phase == "InitialPeek":
            if game_turn is not None:
                raise exceptions.InvalidGameStateException()
            
            if game_session.initial_peek_deadline_at is None:
                raise exceptions.InvalidGameStateException()
        elif game_session.phase == "PlayerTurn":
            if game_turn is None:
                raise exceptions.InvalidGameStateException()

            acting_player = players_by_id.get(game_turn.game_player_id)
            if acting_player is None:
                raise exceptions.InvalidGameStateException()

            active_turn_view = ActiveTurnView(
                id=game_turn.id,
                turn_number=game_turn.turn_number,
                acting_account_id=acting_player.account_id,
                started_at=game_turn.started_at,
                deadline_at=game_turn.deadline_at
            )
        else:
            raise exceptions.InvalidGameStateException()

        game_view = GameView(
            id=game_session.id,
            room_id=game_session.room_id,
            state=game_session.state,
            phase=game_session.phase,
            viewer_account_id=viewer.account_id,
            players=players_views,
            draw_pile=draw_pile_view,
            discard_pile=discard_pile_view,
            active_turn=active_turn_view,
            initial_peek_deadline_at=(
                game_session.initial_peek_deadline_at
                if game_session.phase == "InitialPeek"
                else None
            ),
            server_time=datetime.now(timezone.utc),
            schema_version=0
        )

        session.commit()

        return game_view
    except Exception:
        session.rollback()
        raise