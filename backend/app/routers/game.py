from fastapi import APIRouter, status
from uuid import UUID

from app.schemas import (InitialPeekCommandOutcome, InitialPeekCommandRequest,
                         GameView)
from app.depencicies import OriginCheckDep, SessionDep, ActiveUserDep
from app.services import game_command, game

router = APIRouter(
    prefix="/games",
    tags=["games"]
)

@router.post(
    "/{game_session_id}/commands/initial-peek",
    status_code=status.HTTP_200_OK,
    response_model=InitialPeekCommandOutcome,
    dependencies=[OriginCheckDep]
)
def initial_peek_command(
    session: SessionDep,
    user: ActiveUserDep,
    game_session_id: UUID,
    body: InitialPeekCommandRequest
):
    return game_command.execute_initial_peek_command(
        session,
        game_session_id,
        user,
        body.request_id,
        body.position
    )

@router.get(
    "/{game_session_id}",
    status_code=status.HTTP_200_OK,
    response_model=GameView,
    dependencies=[OriginCheckDep]
)
def get_game_view(
    session: SessionDep,
    user: ActiveUserDep,
    game_session_id: UUID,
):
    return game.get_game_view(
        session,
        user,
        game_session_id
    )