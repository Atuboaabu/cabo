from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse

from app.exc import exceptions

def register_exception_handlers(app: FastAPI)->None:
    @app.exception_handler(exceptions.InvalidUsernameException)
    async def invalid_username_handle(
        request: Request,
        exc: exceptions.InvalidUsernameException
    ):
        return JSONResponse(
            status_code = status.HTTP_400_BAD_REQUEST,
            content = {
                "code": "INVALID_USERNAME",
                "detail": f"Invalid username: {exc.name}" 
            }
        )
    
    @app.exception_handler(exceptions.InvalidEmailAddressException)
    async def invalid_email_handle(
        request: Request,
        exc: exceptions.InvalidEmailAddressException
    ):
        return JSONResponse(
            status_code = status.HTTP_400_BAD_REQUEST,
            content = {
                "code": "INVALID_EMAIL_ADDRESS",
                "detail": f"Invalid email address: {exc.email}" 
            }
        )
    
    @app.exception_handler(exceptions.VerificationCodeNotMatchException)
    async def verification_code_not_match_handle(
        request: Request,
        exc: exceptions.VerificationCodeNotMatchException
    ):
        return JSONResponse(
            status_code = status.HTTP_400_BAD_REQUEST,
            content = {
                "code": "INVALID_VERIFICATION_CODE",
                "detail": "Vericication code Wrong or expired" 
            }
        )
    
    @app.exception_handler(exceptions.UserAccountExistedException)
    async def user_account_existed_handle(
        request: Request,
        exc: exceptions.UserAccountExistedException
    ):
        return JSONResponse(
            status_code = status.HTTP_409_CONFLICT,
            content = {
                "code": "USER_ACCOUNT_EXSISTED",
                "detail": "User account is already existed" 
            }
        )
    
    @app.exception_handler(exceptions.UserNameConflictException)
    async def username_existed_handle(
        request: Request,
        exc: exceptions.UserNameConflictException
    ):
        return JSONResponse(
            status_code = status.HTTP_409_CONFLICT,
            content = {
                "code": "USERNAME_TAKEN",
                "detail": "Username is already taken" 
            }
        )