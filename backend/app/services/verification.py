from sqlalchemy import select, func, text
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert
from datetime import datetime, timezone, timedelta

from app.security.verification import generate_code, hash_verification_code, compare_verification_code
from app.models import EmailVerificationCode

MAX_ATTEMPTS = 5

def generate_email_verification_code(
    session: Session,
    normalized_email: str,
    purpose: str = "registration"
)->str | None:
    email_verification_code = generate_code(6)
    code_digest = hash_verification_code(
        code = email_verification_code,
        normalized_email=normalized_email,
        purpose=purpose
    )
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=5)

    try:
        statement = insert(EmailVerificationCode).values(
            normalized_email=normalized_email,
            code_digest=code_digest,
            expires_at=expires_at,
            consumed_at=None,
            attempt_count=0,
            last_issued_at=func.now()
        ).on_conflict_do_update(
            index_elements = [EmailVerificationCode.normalized_email],
            set_={
                "code_digest": code_digest,
                "expires_at": expires_at,
                "consumed_at": None,
                "attempt_count": 0,
                "last_issued_at": func.now()
            },
            where=(
                EmailVerificationCode.last_issued_at <= func.now() - text("INTERVAL '60 seconds'")
            ),
        ).returning(
            EmailVerificationCode.id
        )

        verify_id = session.execute(
            statement
        ).scalar_one_or_none()
        session.commit()

        if verify_id is None:
            return None

    except Exception:
        session.rollback()
        raise

    return email_verification_code

def verify_email_verification_code(
    session: Session,
    code: str,
    normalized_email: str,
    purpose: str = "registration"
)->bool:
    statement = select(EmailVerificationCode).where(
        EmailVerificationCode.normalized_email == normalized_email
    ).with_for_update()

    stored_verification_code = session.execute(
        statement
    ).scalar_one_or_none()

    if stored_verification_code is None:
        return False
    
    if ((stored_verification_code.consumed_at is not None) or
        (stored_verification_code.attempt_count >= MAX_ATTEMPTS) or
        (stored_verification_code.expires_at <= datetime.now(timezone.utc))):
        return False

    compare_result = compare_verification_code(
        code=code,
        stored_digest=stored_verification_code.code_digest,
        normalized_email=normalized_email,
        purpose=purpose
    )
    if not compare_result:
        stored_verification_code.attempt_count += 1
        session.flush()
        return False

    stored_verification_code.consumed_at = datetime.now(timezone.utc)
    session.flush()

    return True