from fastapi import APIRouter, status

from app.depencicies.session import SessionDep
from app.schemas import UserAccountCreate, UserAccountResponse, VerificationCodeRequest
from app.services import accounts, verification
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
    print(f"get_verification_code result = {result}")

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