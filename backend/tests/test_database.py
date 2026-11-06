from sqlmodel import create_engine, Session
from sqlalchemy import text

from app.config import settings

engine = create_engine(
    url = settings.test_database_url,
    echo = settings.sql_echo,
)

def test_postgre_db_ready():
    with Session(engine) as session:
        result = session.execute(text("SELECT 1;")).scalar_one_or_none()
        assert result == 1