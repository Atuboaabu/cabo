from fastapi import Depends
from sqlalchemy.orm import Session
from typing import Annotated

from app.database import engine


def get_session():
    with Session(engine) as session:
        yield session

SessionDep = Annotated[Session, Depends(get_session)]