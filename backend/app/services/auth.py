from sqlalchemy import select
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone

from app.models import UserAccount, AuthSession
from app.normalization import normalize_email
from app.exc import exceptions
from app.security.password import verify_password, hash_password
from app.security.session_token import generate_session_token
from app.config import settings

DUMMY_HASHED_PASSWORD = hash_password("dummy-password")

def authenticate_account(
    session: Session,
    email: str,
    password: str
)->UserAccount:
    _, normalized_email = normalize_email(email)
    user_account = session.execute(
        select(UserAccount).where(
            UserAccount.normalized_email == normalized_email
        )
    ).scalar_one_or_none()

    if user_account is None:
        verify_password(password, DUMMY_HASHED_PASSWORD)
        raise exceptions.InvalidCredentialsException()
    
    if not verify_password(password, user_account.hashed_password):
        raise exceptions.InvalidCredentialsException()

    return user_account

def create_auth_session(
    session: Session,
    account: UserAccount
)->str:
    token, token_digest = generate_session_token()
    now = datetime.now(timezone.utc)
    last_activity_at = now
    absolute_expires_at = now + timedelta(seconds=settings.session_absolute_timeout_seconds)
    idle_expires_at = min(
        now + timedelta(seconds=settings.session_idle_timeout_seconds),
        absolute_expires_at
    )
    

    try:
        auth_session = AuthSession(
            account_id = account.id,
            token_digest = token_digest,
            last_activity_at = last_activity_at,
            idle_expires_at = idle_expires_at,
            absolute_expires_at = absolute_expires_at,
            revoked_at = None
        )
        session.add(auth_session)
        session.commit()
        return token
    except Exception:
        session.rollback()
        raise 
    