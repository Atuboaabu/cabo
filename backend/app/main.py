from fastapi import FastAPI

from app.exc import exception_handlers
from app.routers import auth, health

app = FastAPI()

exception_handlers.register_exception_handlers(app)

app.include_router(auth.router)
app.include_router(health.router)
