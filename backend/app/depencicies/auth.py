from sqlalchemy.orm import Session
from fastapi import Request, Depends
from typing import Annotated

from app.models import UserAccount
from app.services import auth
from app.exc import exceptions

def get_active_useraccount(
    session: Session,
    request: Request
)->UserAccount:
    token = request.cookies.get("session_token")
    if not token:
        raise exceptions.InvalidCookieException()

    user = auth.get_authenticated_account(
        session,
        token
    )
    return user

ActiveUserDep = Annotated[UserAccount, Depends(get_active_useraccount)]