from sqlalchemy import func, text, and_, or_, case
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert

from app.security.login_rate_limit import hash_rate_limit_subject, compare_rate_limit_subject
from app.models import LoginRateLimit
from app.config import settings
from app.exc import exceptions

def check_and_record_login_attempt(
    session: Session,
    scope: str,
    subject: str,
)->None:
    subject_digest = hash_rate_limit_subject(
        scope=scope,
        subject=subject
    )
    if scope == "ip":
        limit = settings.login_ip_limit
        window_seconds = settings.login_ip_window_seconds
    elif scope == "email":
        limit = settings.login_email_limit
        window_seconds = settings.login_email_window_seconds
    else:
        raise ValueError(f"wrong parameter: scope: {scope}")

    window_exppired = (LoginRateLimit.window_started_at + 
            func.make_interval(seconds=window_seconds) <= func.now())
    statement = insert(LoginRateLimit).values(
        scope=scope,
        subject_digest=subject_digest,
        window_started_at=func.now(),
        attempt_count=1
    ).on_conflict_do_update(
        index_elements=[LoginRateLimit.scope, LoginRateLimit.subject_digest],
        set_={
            "attempt_count": case(
                (window_exppired, 1),
                else_= LoginRateLimit.attempt_count + 1
            ),
            "window_started_at": case(
                (window_exppired, func.now()),
                else_=LoginRateLimit.window_started_at
            )
        },
        where=(
            or_(
                window_exppired,
                LoginRateLimit.attempt_count < limit
            )
        )
    ).returning(
        LoginRateLimit.id
    )

    login_ratelimit_id = session.execute(
        statement
    ).scalar_one_or_none()

    if login_ratelimit_id is None:
        raise exceptions.LoginRateLimitException()
    session.flush()

def check_login_ratelimit(
    session: Session,
    ratelimit_info: list[tuple[str, str]]
):
    try:
        for (scope, subject) in ratelimit_info:
            check_and_record_login_attempt(session, scope, subject)
        session.commit()
    except Exception:
        session.rollback()
        raise
