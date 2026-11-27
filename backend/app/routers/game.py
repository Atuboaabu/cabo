from fastapi import APIRouter, status, Request
from uuid import UUID
from starlette.concurrency import run_in_threadpool

from app.schemas import (InitialPeekCommandOutcome, InitialPeekCommandRequest,
                         GameView, InitialPeekPrivateView, InitialPeekCompleteCommandOutcome,
                         InitialPeekCompleteCommandRequest, DrawPilePrivateViewCommandOutCome,
                         DrawPilePrivateViewCommandRequest)
from app.depencicies import OriginCheckDep, SessionDep, ActiveUserDep
from app.services import game_command, game
from app.websocket.notification import notification_game_changed
from app.exc import exceptions

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
async def initial_peek_command(
    request: Request,
    game_session_id: UUID,
    body: InitialPeekCommandRequest
):
    token = request.cookies.get("session_token")
    if not token:
        raise exceptions.InvalidCookieException()

    outcome = await run_in_threadpool(
        game_command.execute_initial_peek_command,
        token,
        game_session_id,
        body.request_id,
        body.position
    )
    
    if outcome.status == "Accepted" and not outcome.replayed:
        await notification_game_changed(game_session_id)

    return outcome

@router.get(
    "/{game_session_id}",
    status_code=status.HTTP_200_OK,
    response_model=GameView
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

@router.get(
    "/{game_session_id}/initial-peek-view",
    status_code=status.HTTP_200_OK,
    response_model=InitialPeekPrivateView
)
def get_initial_peek_view(
    session: SessionDep,
    user: ActiveUserDep,
    game_session_id: UUID,
):
    return game.get_initial_peek_view(
        session,
        user,
        game_session_id
    )

@router.post(
    "/{game_session_id}/commands/complete-initial-peek",
    status_code=status.HTTP_200_OK,
    response_model=InitialPeekCompleteCommandOutcome,
    dependencies=[OriginCheckDep]
)
async def complete_initial_peek_command(
    request: Request,
    game_session_id: UUID,
    body: InitialPeekCompleteCommandRequest
):  
    token = request.cookies.get("session_token")
    if not token:
        raise exceptions.InvalidCookieException()

    outcome = await run_in_threadpool(
        game_command.execute_complete_initial_peek_command,
        token,
        game_session_id,
        body.request_id
    )
    
    if outcome.status == "Accepted" and not outcome.replayed:
        await notification_game_changed(game_session_id)

    return outcome

@router.post(
    "/{game_session_id}/commands/draw-from-drawpile",
    status_code=status.HTTP_200_OK,
    response_model=DrawPilePrivateViewCommandOutCome,
    dependencies=[OriginCheckDep]
)
async def draw_from_drawpile_command(
    request: Request,
    game_session_id: UUID,
    body: DrawPilePrivateViewCommandRequest
):  
    token = request.cookies.get("session_token")
    if not token:
        raise exceptions.InvalidCookieException()

    outcome = await run_in_threadpool(
        game_command.execute_draw_from_drawpile_command,
        token,
        game_session_id,
        body.request_id
    )
    
    if outcome.status == "Accepted" and not outcome.replayed:
        await notification_game_changed(game_session_id)

    return outcome