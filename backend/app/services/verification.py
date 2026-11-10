from sqlalchemy.orm import Session
from sqlalchemy import select
from datetime import datetime, timezone, timedelta

from app.security.verification import generate_code, hash_verification_code
from app.normalization import normalize_email
from app.models import EmailVerificationCode
from app.exceptions import VerificationAttemptLimitExceedException

def generate_and_send_email_verification_code(
    session: Session,
    email: str,
    purpose: str
):
    email_verification_code = generate_code(6)
    display_email, normalized_email = normalize_email(email)

    code_digest = hash_verification_code(
        code = email_verification_code,
        normalized_email=normalized_email,
        purpose=purpose
    )

    expires_at = datetime.now(timezone.utc) + timedelta(minutes=5)

    try:
        verify_code = session.execute(
            select(EmailVerificationCode).where(
                EmailVerificationCode.normalized_email == normalized_email
            ).with_for_update()
        ).scalar_one_or_none()
        if verify_code is None:
            verify_code = EmailVerificationCode(
                normalized_email=normalized_email,
                code_digest=code_digest,
                expires_at=expires_at,
                consumed_at=None,
                attempt_count=0
            )
        else:
            verify_code.code_digest = code_digest
            verify_code.expires_at = expires_at
            verify_code.consumed_at = None
            verify_code.attempt_count += 1
            if verify_code.attempt_count >= 3:
                raise VerificationAttemptLimitExceedException(email=display_email)
        
        session.add(verify_code)
        session.commit()

    except Exception:
        session.rollback()
        raise

    