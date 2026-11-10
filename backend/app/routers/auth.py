from fastapi import APIRouter

from app.depencicies.session import SessionDep
from app.schemas import UserAccountCreate
from app.services import accounts

router = APIRouter(
    prefix="/auth",
    tags=["auth"]
)

@router.post(
    "/verification-codes",
)
def get_verification_code(
    session: SessionDep,
    email: str,
    purpose: str
):
    pass

@router.post(
    "/register"
)
def register_useraccount(
    session: SessionDep,
    user_data: UserAccountCreate
):
    return accounts.create_useraccount(
        session,
        user_data
    )