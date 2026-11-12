from sqlalchemy import func, text, and_, or_
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

    try:

        statement = insert(LoginRateLimit).values(
            scope=scope,
            subject_digest=subject_digest,
            window_started_at=func.now(),
            attempt_count=1
        ).on_conflict_do_update(
            index_elements=[LoginRateLimit.scope, LoginRateLimit.subject_digest],
            set_={
                "attempt_count": LoginRateLimit.attempt_count + 1,
            },
            where=(
                or_(
                    and_(
                        LoginRateLimit.window_started_at + 
                            text(f"INTERVAL '{settings.login_ip_window_seconds} seconds'") < func.now(),
                        LoginRateLimit.attempt_count < settings.login_ip_limit,
                        LoginRateLimit.scope == "ip"
                    ),
                    and_(
                        LoginRateLimit.window_started_at + 
                            text(f"INTERVAL '{settings.login_email_window_seconds} seconds'") < func.now(),
                        LoginRateLimit.attempt_count < settings.login_email_limit,
                        LoginRateLimit.scope == "email"
                    )
                )
                
            )
        ).on_conflict_do_update(
            index_elements=[LoginRateLimit.scope, LoginRateLimit.subject_digest],
            set_={
                "attempt_count": 1,
                "window_started_at": func.now()
            },
            where=(
                or_(
                    and_(
                        LoginRateLimit.window_started_at + 
                            text(f"INTERVAL '{settings.login_ip_window_seconds} seconds'") >= func.now(),
                        LoginRateLimit.scope == "ip"
                    ),
                    and_(
                        LoginRateLimit.window_started_at + 
                            text(f"INTERVAL '{settings.login_email_window_seconds} seconds'") >= func.now(),
                        LoginRateLimit.scope == "email"
                    )
                )
            )
        ).returning(
            LoginRateLimit.id
        )
    
        login_ratelimit_id = session.execute(
            statement
        ).scalar_one_or_none()
    
        if login_ratelimit_id is None:
            exceptions.LoginRateLimitException()

        session.commit()
    except Exception:
        session.rollback()
        raise

