from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.game_logic.config import TURN_DURATION_SECONDS
from app.models import GameCard, GamePlayer, GameSession, GameTurn


@dataclass(frozen=True)
class TurnAdvanceResult:
    status: Literal["NextTurnCreated", "SettlingStarted"]
    next_turn: GameTurn | None


def count_draw_pile_cards(
    session: Session,
    game_session_id: UUID,
) -> int:
    return session.execute(
        select(func.count()).select_from(GameCard).where(
            GameCard.game_session_id == game_session_id,
            GameCard.location == "DrawPile",
        )
    ).scalar_one()


def select_next_game_player(
    session: Session,
    game_session_id: UUID,
    current_seat_index: int,
) -> GamePlayer:
    players = session.execute(
        select(GamePlayer).where(
            GamePlayer.game_session_id == game_session_id,
        ).order_by(
            GamePlayer.seat_index
        )
    ).scalars().all()

    if len(players) < 2:
        raise RuntimeError("A round requires at least two GamePlayers")

    return next(
        (
            player
            for player in players
            if player.seat_index > current_seat_index
        ),
        players[0],
    )


def advance_turn_after_completion(
    session: Session,
    game_session: GameSession,
    completed_turn: GameTurn,
) -> TurnAdvanceResult:
    """Schedule the successor Turn, or enter Settling when the DrawPile is empty.

    The caller owns the transaction and the single state_revision bump.
    """
    if completed_turn.game_session_id != game_session.id:
        raise RuntimeError("Completed Turn does not belong to this GameSession")

    if game_session.state != "Playing" or game_session.phase != "PlayerTurn":
        raise RuntimeError("GameSession is not in an active PlayerTurn phase")

    if completed_turn.state != "Completed" or completed_turn.ended_at is None:
        raise RuntimeError("Turn must be completed before scheduling a successor")

    active_turn_count = session.execute(
        select(func.count()).select_from(GameTurn).where(
            GameTurn.game_session_id == game_session.id,
            GameTurn.ended_at.is_(None),
        )
    ).scalar_one()
    if active_turn_count != 0:
        raise RuntimeError("GameSession already has an active Turn")

    latest_turn_number = session.execute(
        select(func.max(GameTurn.turn_number)).where(
            GameTurn.game_session_id == game_session.id,
        )
    ).scalar_one()
    if latest_turn_number != completed_turn.turn_number:
        raise RuntimeError("Only the latest completed Turn can schedule a successor")

    current_player = session.get(GamePlayer, completed_turn.game_player_id)
    if current_player is None or current_player.game_session_id != game_session.id:
        raise RuntimeError("Completed Turn has no GamePlayer in this GameSession")

    pending_action_card_count = session.execute(
        select(func.count()).select_from(GameCard).where(
            GameCard.game_session_id == game_session.id,
            GameCard.location == "PendingAction",
        )
    ).scalar_one()
    if pending_action_card_count != 0:
        raise RuntimeError("Completed Turn still has a PendingAction card")

    if count_draw_pile_cards(session, game_session.id) == 0:
        # Temporary until GameRound settlement exists; PlayerTurn without an
        # active Turn would violate the GameView invariant.
        game_session.phase = "Settling"
        session.flush()
        return TurnAdvanceResult(status="SettlingStarted", next_turn=None)

    next_player = select_next_game_player(
        session,
        game_session.id,
        current_player.seat_index,
    )
    now = datetime.now(timezone.utc)
    next_turn = GameTurn(
        game_session_id=game_session.id,
        game_player_id=next_player.id,
        turn_number=completed_turn.turn_number + 1,
        state="AwaitingAction",
        started_at=now,
        deadline_at=now + timedelta(seconds=TURN_DURATION_SECONDS),
    )
    session.add(next_turn)
    session.flush()

    return TurnAdvanceResult(status="NextTurnCreated", next_turn=next_turn)
