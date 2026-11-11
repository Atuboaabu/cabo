from fastapi import FastAPI

from app.exc import exception_handlers
from app.routers import auth, health
from app.logging_config import configure_logging

configure_logging()

app = FastAPI()

exception_handlers.register_exception_handlers(app)

app.include_router(auth.router)
app.include_router(health.router)
