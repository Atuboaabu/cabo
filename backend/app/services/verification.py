from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert
from datetime import datetime, timezone, timedelta

from app.security.verification import generate_code, hash_verification_code
from app.models import EmailVerificationCode

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
            attempt_count=0
        ).on_conflict_do_update(
            index_elements = [EmailVerificationCode.normalized_email],
            set_={
                "code_digest": code_digest,
                "expires_at": expires_at,
                "consumed_at": None,
                "attempt_count": 0
            }
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

def send_email_verification_code(
    session: Session,
    email_address: str,
    verification_code: str
):
    # TODO: send_email_verify_code(email_address, verification_code)
    pass