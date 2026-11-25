from sqlalchemy.orm import Session
from sqlalchemy import select
from uuid import UUID

from app.models import GameSession, GamePlayer, UserAccount
from app.exc import exceptions

def get_locked_game_session(
    session: Session,
    game_session_id: UUID
)->GameSession | None:
    game_session = session.execute(
        select(GameSession).where(
            GameSession.id == game_session_id
        ).with_for_update()
    ).scalar_one_or_none()
    return game_session

def get_locked_game_context(
    session: Session,
    user_account: UserAccount,
    game_session_id: UUID
)->tuple[GameSession, GamePlayer]:
    game_session = get_locked_game_session(
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