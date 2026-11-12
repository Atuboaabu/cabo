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

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8"
    )

settings = Setting()