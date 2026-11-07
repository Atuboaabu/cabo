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

def test_user_accounts_unique_normalized_username():
    with Session(engine) as session:
        alice = session.execute(
            select(UserAccount).where(
                UserAccount.normalized_username == "alice"
            )
        ).scalar_one_or_none()
        if alice is not None:
            session.delete(alice)
            session.commit()

        count_before = session.execute(
            select(func.count()).select_from(UserAccount)
        ).scalar_one()

        user_1 = UserAccount(
            username = "Alice",
            normalized_username = "alice",
            email = "A123@qq.com",
            normalized_email = "a123@qq.com",
            hashed_password = "12345"
        )

        session.add(user_1)
        session.flush()
        session.commit()
        session.refresh(user_1)

        with pytest.raises(
            IntegrityError
        ):
            try:
                user_2 = UserAccount(
                    username = "alice",
                    normalized_username = "alice",
                    email = "B456@qq.com",
                    normalized_email = "b456@qq.com",
                    hashed_password = "456789"
                )

                session.add(user_2)
                session.flush()
            except IntegrityError:
                session.rollback()
                raise
        session.commit()

        count_after = session.execute(
            select(func.count()).select_from(UserAccount)
        ).scalar_one()

        assert (count_after - count_before) == 1

        user_get = session.execute(
            select(UserAccount).where(UserAccount.normalized_username == "alice")
        ).scalar_one_or_none()

        assert user_get is not None
        assert user_get.id == user_1.id

def test_user_accounts_unique_normalized_email():
    with Session(engine) as session:
        user = session.execute(
            select(UserAccount).where(
                UserAccount.normalized_email == "unique_address_123@qq.com"
            )
        ).scalar_one_or_none()
        if user is not None:
            session.delete(user)
            session.commit()

        count_before = session.execute(
            select(func.count()).select_from(UserAccount)
        ).scalar_one()

        Bob = UserAccount(
            username = "Bob",
            normalized_username = "bob",
            email = "Unique_address_123@qq.com",
            normalized_email = "unique_address_123@qq.com",
            hashed_password = "12345"
        )

        session.add(Bob)
        session.flush()
        session.commit()
        session.refresh(Bob)

        with pytest.raises(
            IntegrityError
        ):
            try:
                Seven = UserAccount(
                    username = "Seven",
                    normalized_username = "seven",
                    email = "UNIQUE_address_123@qq.com",
                    normalized_email = "unique_address_123@qq.com",
                    hashed_password = "456789"
                )

                session.add(Seven)
                session.flush()
            except IntegrityError:
                session.rollback()
                raise
        session.commit()

        count_after = session.execute(
            select(func.count()).select_from(UserAccount)
        ).scalar_one()

        assert (count_after - count_before) == 1

        user_get = session.execute(
            select(UserAccount).where(UserAccount.normalized_email == "unique_address_123@qq.com")
        ).scalar_one_or_none()

        assert user_get is not None
        assert user_get.id == Bob.id
