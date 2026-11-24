from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.models import GameCommandRequest
from app.schemas import InitialPeekCommandPayload

def normalize_command_payload(
    command_type: str,
    payload: dict
)->dict:
    if command_type == "InitialPeek":
        return InitialPeekCommandPayload.model_validate(
            payload
        ).model_dump()
    raise ValueError("Unsupported command type")

def get_command_request(
    session: Session,
    game_session_id: UUID,
    account_id: UUID,
    request_id: UUID
)->GameCommandRequest | None:
    return session.execute(
        select(GameCommandRequest).where(
            GameCommandRequest.game_session_id == game_session_id,
            GameCommandRequest.account_id == account_id,
            GameCommandRequest.request_id == request_id
        )
    ).scalar_one_or_none()

def is_same_command_request(
    existing_request: GameCommandRequest,
    command_type: str,
    nomalized_payload: dict
)->bool:
    return (
        existing_request.command_type == command_type and 
        existing_request.request_payload == nomalized_payload
    )
    
