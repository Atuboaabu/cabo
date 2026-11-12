import uuid
from datetime import datetime
from pydantic import BaseModel, Field, EmailStr
from typing import Literal

class UserAccountCreate(BaseModel):
    username: str = Field(
        min_length=3,
        max_length=100,
        description="用户昵称"
    )

    email: EmailStr

    password: str = Field(
        min_length=6,
        max_length=100,
        description="用户密码"
    )

    verification_code: str

class UserAccountResponse(BaseModel):
    id: uuid.UUID
    username: str
    email: str
    created_at: datetime

class UserAccountLogin(BaseModel):
    email: EmailStr
    password: str

class VerificationCodeRequest(BaseModel):
    email_address: EmailStr
    purpose: Literal["registration"]