from pydantic_settings import BaseSettings, SettingsConfigDict

class Setting(BaseSettings):
    database_url: str
    test_database_url: str
    sql_echo: bool = True
    verification_hmac_key: bytes

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8"
    )

settings = Setting()