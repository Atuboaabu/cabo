from uuid import UUID
from dataclasses import dataclass
from sqlalchemy.orm import Session
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from datetime import datetime, timezone

from app.models import GameCommandRequest, UserAccount, GamePlayer
from app.schemas import InitialPeekCommandPayload, InitialPeekResult, InitialPeekCommandOutcome
from app.services import game_context, game
from app.exc import exceptions

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
    normalized_payload: dict
)->bool:
    return (
        existing_request.command_type == command_type and 
        existing_request.request_payload == normalized_payload
    )

@dataclass(frozen=True)
class CommandRequestLookup:
    created: bool
    request: GameCommandRequest

def create_pending_command_request(
    session: Session,
    game_session_id: UUID,
    account_id: UUID,
    request_id: UUID,
    command_type: str,
    normalized_payload: dict
)->CommandRequestLookup:
    created_result = session.execute(
        insert(GameCommandRequest).values(
            game_session_id=game_session_id,
            account_id=account_id,
            request_id=request_id,
            command_type=command_type,
            status="Pending",
            request_payload=normalized_payload,
        ).on_conflict_do_nothing(
            constraint="uq_game_command_requests_identity"
        ).returning(
            GameCommandRequest
        )
    ).scalar_one_or_none()

    if created_result is not None:
        return CommandRequestLookup(
            created=True,
            request=created_result
        )
    
    existing_result = get_command_request(
        session,
        game_session_id,
        account_id,
        request_id
    )
    if existing_result is None:
        raise RuntimeError(
            "Conflicting command request could not be found"
        )
    
    return CommandRequestLookup(
        created=False,
        request=existing_result
    )

BUSINESS_REJECTIONS = {
    exceptions.GameAlreadyEndedException: "GAME_ENDED",
    exceptions.InvalidGameStateException: "INVALID_GAME_STATE",
    exceptions.InitialPeekExpiredException: "INITIAL_PEEK_EXPIRED",
    exceptions.InitialPeekCompletedException: "INITIAL_PEEK_COMPLETED",
    exceptions.InvalidPeekTargetException: "INVALID_PEEK_TARGET",
    exceptions.RepeatedPeekException: "REPEATED_PEEK",
    exceptions.InitialPeekCountExceedException: "PEEK_LIMIT_EXCEEDED",
}

def execute_initial_peek_command(
    session: Session,
    game_session_id: UUID,
    user_account: UserAccount,
    request_id: UUID,
    position: int
)->InitialPeekCommandOutcome:
    try:
        payload = normalize_command_payload(
            "InitialPeek",
            {"position": position}
        )

        game_session = game_context.get_locked_game_session(
            session,
            game_session_id
        )

        game_player = session.execute(
            select(GamePlayer).where(
                GamePlayer.game_session_id == game_session_id,
                GamePlayer.account_id == user_account.id
            )
        ).scalar_one_or_none()

        if game_session is None or game_player is None:
            raise exceptions.GameNotAccessibleException()
    
        lookup = create_pending_command_request(
            session,
            game_session_id,
            user_account.id,
            request_id,
            "InitialPeek",
            payload
        )

        request = lookup.request

        if not lookup.created:
            if not is_same_command_request(
                request,
                "InitialPeek",
                payload
            ):
                outcome = InitialPeekCommandOutcome(
                    status="IdentityConflict",
                    replayed=True
                )
            elif request.status == "Pending":
                outcome = InitialPeekCommandOutcome(
                    status="NotYetDetermined",
                    replayed=True
                )
            else:
                outcome = InitialPeekCommandOutcome(
                    status=request.status,
                    replayed=True,
                    reason=(
                        request.result_payload or {}
                    ).get("reason")
                )

            session.commit()
            return outcome
        try:
            peek_result = game.apply_initial_peek(
                session,
                user_account,
                game_session_id,
                position
            )
        except tuple(BUSINESS_REJECTIONS) as exc:
            reason = BUSINESS_REJECTIONS[type(exc)]
            request.status = "Rejected"
            request.decided_at = datetime.now(timezone.utc)
            request.result_payload = {"reason": reason}

            session.commit()
            return InitialPeekCommandOutcome(
                status="Rejected",
                replayed=False,
                reason=reason
            )

        request.status = "Accepted"
        request.decided_at = datetime.now(timezone.utc)
        request.result_payload = {
            "position": peek_result.position,
            "remaining_peek_count": peek_result.remaining_peek_count
        }
        session.commit()

        return InitialPeekCommandOutcome(
            status="Accepted",
            replayed=False,
            peek_result=(
                peek_result
                if peek_result.deadline_at > datetime.now(timezone.utc)
                else None
            ),
        )

    except Exception:
        session.rollback()
        raise