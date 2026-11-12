from sqlalchemy import select, func, update
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone

from app.models import UserAccount, AuthSession
from app.normalization import normalize_email
from app.exc import exceptions
from app.security.password import verify_password, hash_password
from app.security.session_token import generate_session_token, generate_token_digest
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

def get_authenticated_account(
    session: Session,
    token: str
)->UserAccount:
    token_digest = generate_token_digest(token)

    auth_session = session.execute(
        select(AuthSession).where(
            AuthSession.token_digest == token_digest,
            AuthSession.revoked_at.is_(None),
            AuthSession.idle_expires_at > func.now(),
            AuthSession.absolute_expires_at > func.now()
        )
    ).scalar_one_or_none()

    if auth_session is None:
        raise exceptions.InvalidCookieException()

    user_account = session.execute(
        select(UserAccount).where(
            UserAccount.id == auth_session.account_id
        )
    ).scalar_one_or_none()

    if user_account is None:
        raise exceptions.InvalidCookieException()

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

def revoke_auth_session(
    session: Session,
    token: str
)->None:
    try:
        token_digest = generate_token_digest(token)
        statement = update(AuthSession).values(
            revoked_at = func.now()
        ).where(
            AuthSession.token_digest == token_digest,
            AuthSession.revoked_at.is_(None)
        )
        session.execute(statement)
        session.commit()
    except Exception:
        session.rollback()
        raise


    