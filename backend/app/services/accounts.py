from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.schemas import UserAccountCreate, UserAccountResponse
from app.models import UserAccount
from app.services import verification
from app.normalization import normalize_email, normalize_name
from app.security import password

from app.exceptions import (VerificationCodeNotMatchException,
                            UserAccountExistedException,
                            UserNameConflictException,)


def create_useraccount(
    session: Session,
    user_data: UserAccountCreate
)->UserAccountResponse:
    code = user_data.verification_code
    display_email, normalized_email = normalize_email(user_data.email)
    hashed_password = password.hash_password(user_data.password)
    try:
        if not verification.verify_email_verification_code(
            session,
            code,
            normalized_email,
            "registration"
        ):
            session.commit()
            raise VerificationCodeNotMatchException()
        else:
            user_account = session.execute(
                select(UserAccount).where(
                    UserAccount.normalized_email == normalized_email
                )
            ).scalar_one_or_none()
            if user_account is not None:
                raise UserAccountExistedException()
            
            display_name, normalized_username = normalize_name(user_data.username)
            user_account = session.execute(
                select(UserAccount).where(
                    UserAccount.normalized_username == normalized_username
                )
            ).scalar_one_or_none()
            if user_account is not None:
                raise UserNameConflictException()

            user_account = UserAccount(
                username = display_name,
                normalized_username = normalized_username,
                email = display_email,
                normalized_email = normalized_email,
                hashed_password = hashed_password
            )
            session.add(user_account)
            session.flush()
            assert user_account.id is not None
            session.commit()
    except IntegrityError as exc:
        session.rollback()
        if getattr(exc.orig, "sqlstate", None) == "23505":
            constraint_name = exc.orig.diag.constraint_name

            if constraint_name == "user_accounts_normalized_username_key":
                raise UserNameConflictException() from exc
            
            if constraint_name == "user_accounts_normalized_email_key":
                raise UserAccountExistedException() from exc
        raise
    except Exception:
        session.rollback()
        raise

    session.refresh(user_account)
    return UserAccountResponse(
        id = user_account.id,
        username = user_account.username,
        email = user_account.email,
        created_at = user_account.created_at
    )