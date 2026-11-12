from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

class Setting(BaseSettings):
    database_url: str
    test_database_url: str
    sql_echo: bool = True
    verification_hmac_key: bytes
    resend_api_key: str
    email_from_address: str
    session_idle_timeout_seconds: int = Field(
        default=1800,
        gt=0
    )
    session_absolute_timeout_seconds: int = Field(
        default=604800,
        gt=0
    )
    session_cookie_secure: bool = True
    allowed_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:8000",
    ]

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8"
    )

    login_ip_limit: int = Field(
        default=10,
        gt=0
    )

    login_ip_window_seconds: int = Field(
        default=60,
        gt=0
    )

    login_email_limit: int = Field(
        default=10,
        gt=0
    )

    login_email_window_seconds: int = Field(
        default=300,
        gt=0
    )

    rate_limit_hmac_key: bytes

settings = Setting()