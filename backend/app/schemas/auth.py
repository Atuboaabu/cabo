from pydantic import BaseModel, EmailStr
from typing import Literal

class VerificationCodeRequest(BaseModel):
    email_address: EmailStr
    purpose: Literal["registration"]