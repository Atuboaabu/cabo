from sqlalchemy import text, select, func, delete
from sqlalchemy.engine import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
import pytest
import uuid

from app.config import settings
from app.models import UserAccount

engine = create_engine(
    url = settings.test_database_url,
    echo = settings.sql_echo,
)

def test_postgre_db_ready():
    with Session(engine) as session:
        result = session.execute(text("SELECT 1;")).scalar_one_or_none()
        assert result == 1