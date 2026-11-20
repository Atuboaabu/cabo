from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import select
from datetime import datetime, timezone
from logging import getLogger
from time import sleep
from threading import Thread

from app.models import GameSession
from app.database import engine
from app.services.game import expire_initial_peek
from app.logging_config import configure_logging
from app.config import settings

configure_logging()

logger = getLogger(__name__)

def find_expired_initial_game_ids(
    session: Session,
    limit: int
)->list[UUID]:
    assert limit > 0

    now = datetime.now(timezone.utc)
    game_ids = session.execute(
        select(GameSession.id).where(
            GameSession.state == "Playing",
            GameSession.phase == "InitialPeek",
            GameSession.ended_at.is_(None),
            GameSession.initial_peek_deadline_at.is_not(None),
            GameSession.initial_peek_deadline_at <= now
        ).order_by(
            GameSession.initial_peek_deadline_at,
            GameSession.id
        ).limit(
            limit=limit
        )
    ).scalars().all()

    return list(game_ids)

def process_initial_peek_timeout()->None:

    while True:
        with Session(engine) as session:
            timeout_game_session_ids = find_expired_initial_game_ids(
                session,
                settings.game_timeout_batch_size
            )
        
        if not timeout_game_session_ids:
            sleep(settings.game_timeout_poll_interval_seconds)
            continue

        for game_session_id in timeout_game_session_ids:
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
                        logger.info(
                            "game %s expire initial peek transition success", game_session_id
                        )
            except Exception as exc:
                logger.warning(
                    "game %s expire initial peek catch exception: %s", game_session_id, str(exc)
                )
                continue

        sleep(settings.game_timeout_poll_interval_seconds)

def run_game_timeout_worker()->None:
    init_peek_timeout_thread = Thread(
        target=process_initial_peek_timeout
    )
    init_peek_timeout_thread.start()
    init_peek_timeout_thread.join()

if __name__ == "main":
    run_game_timeout_worker()