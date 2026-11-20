from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import select
from datetime import datetime, timezone
from logging import getLogger
from time import monotonic
from threading import Event
import signal

from app.models import GameSession
from app.database import engine
from app.services.game import expire_initial_peek
from app.logging_config import configure_logging
from app.config import settings

logger = getLogger(__name__)
stop_event = Event()
retry_after_by_game_ids: dict[UUID, float] = {}

def signal_handle(signum, frame):
    stop_event.set()

def find_expired_initial_game_ids(
    session: Session,
    limit: int,
    exclude_game_ids: list[UUID]
)->list[UUID]:
    assert limit > 0

    now = datetime.now(timezone.utc)
    game_ids = session.execute(
        select(GameSession.id).where(
            GameSession.state == "Playing",
            GameSession.phase == "InitialPeek",
            GameSession.ended_at.is_(None),
            GameSession.initial_peek_deadline_at.is_not(None),
            GameSession.initial_peek_deadline_at <= now,
            GameSession.id.not_in(exclude_game_ids)
        ).order_by(
            GameSession.initial_peek_deadline_at,
            GameSession.id
        ).limit(
            limit=limit
        )
    ).scalars().all()

    return list(game_ids)

def process_initial_peek_timeout()->None:
    try:
        with Session(engine) as session:
            timeout_game_session_ids = find_expired_initial_game_ids(
                session,
                settings.game_timeout_batch_size,
                list(retry_after_by_game_ids.keys())
            )
        
        if not timeout_game_session_ids:
            return
    except Exception as exc:
        logger.exception(
            "find expired game occurs exception",
            exc_info=exc
        )
        return

    for game_session_id in timeout_game_session_ids:
        if stop_event.is_set():
            break

        try:
            with Session(engine) as session:
                result = expire_initial_peek(
                    session,
                    game_session_id
                )

                if result.status == "NotDue":
                    continue
                elif result.status == "NotApplicable":
                    continue
                elif result.status == "Transitioned":
                    retry_after_by_game_ids.pop(game_session_id, None)
                    logger.info(
                        "game %s expire initial peek transition success", game_session_id
                    )
        except Exception as exc:
            retry_after_by_game_ids[game_session_id] = (
                monotonic() + 5.0
            )
            logger.exception(
                "game %s expire initial peek occurs exception",
                game_session_id,
                exc_info=exc
            )
            continue

def clear_retry_after_games()->None:
    now = monotonic()
    for game_id, deadline in retry_after_by_game_ids.copy().items():
        if now >= deadline:
            retry_after_by_game_ids.pop(game_id)

def run_game_timeout_worker()->None:
    configure_logging()

    signal.signal(signal.SIGTERM, signal_handle)
    signal.signal(signal.SIGINT, signal_handle)

    while not stop_event.is_set():
        clear_retry_after_games()
        process_initial_peek_timeout()
        stop_event.wait(settings.game_timeout_poll_interval_seconds)

if __name__ == "__main__":
    run_game_timeout_worker()