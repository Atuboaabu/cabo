from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.engine import create_engine

from app.config import settings

class Base(DeclarativeBase):
    pass

engine = create_engine(
    url=settings.database_url,
    echo=settings.sql_echo
)