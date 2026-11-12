from fastapi import APIRouter, status, Response, Request

from app.depencicies.session import SessionDep
from app.schemas import (UserAccountCreate,
                         UserAccountResponse,
                         VerificationCodeRequest,
                         UserAccountLogin)
from app.services import accounts, verification, auth
from app.normalization import normalize_email
from app.integrations import email_sender

router = APIRouter(
    prefix="/auth",
    tags=["auth"]
)

@router.post(
    "/verification-codes",
    status_code=status.HTTP_202_ACCEPTED
)
async def get_verification_code(
    session: SessionDep,
    code_request: VerificationCodeRequest
):
    display_email, normalized_email = normalize_email(code_request.email_address)

    verify_code = verification.generate_email_verification_code(
        session,
        normalized_email,
        code_request.purpose
    )

    assert verify_code is not None

    result = await email_sender.send_verification_email(
        display_email,
        verify_code
    )

@router.post(
    "/register",
    response_model=UserAccountResponse,
    status_code=status.HTTP_201_CREATED
)
def register_useraccount(
    session: SessionDep,
    user_data: UserAccountCreate
):
    return accounts.create_useraccount(
        session,
        user_data
    )

@router.post(
    "/login",
    response_model=UserAccountResponse,
    status_code=status.HTTP_200_OK
)
def login(
    session: SessionDep,
    login_info: UserAccountLogin,
    response: Response
):
    user = auth.authenticate_account(
        session,
        login_info.email,
        login_info.password
    )

    token = auth.create_auth_session(
        session,
        user
    )
    response.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=15 * 24 * 60 * 60,
        path="/"
    )
    
    return UserAccountResponse(
        id = user.id,
        username = user.username,
        email = user.email,
        created_at = user.created_at
    )

@router.get(
    "/me",
    response_model=UserAccountResponse
)
def get_auth_me(
    session: SessionDep,
    request: Request
):
    token = request.cookies["session_token"]
    user = auth.get_authenticated_account(
        session,
        token
    )
    return UserAccountResponse(
        id = user.id,
        username = user.username,
        email = user.email,
        created_at = user.created_at
    )