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
                "code": "EMAIL_ALREADY_REGISTERED",
                "detail": "Email is already registered" 
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
    
    @app.exception_handler(exceptions.EmailSendFailedException)
    async def email_send_failed_handle(
        request: Request,
        exc: exceptions.EmailSendFailedException
    ):
        return JSONResponse(
            status_code = status.HTTP_503_SERVICE_UNAVAILABLE,
            content = {
                "code": "EMAIL_SEND_ERROR",
                "detail": f"Email send failed, content: {exc.content}" 
            }
        )
    
    @app.exception_handler(exceptions.VerificationCodeRateLimitException)
    async def verification_code_rate_limit_handle(
        request: Request,
        exc: exceptions.VerificationCodeRateLimitException
    ):
        return JSONResponse(
            status_code = status.HTTP_429_TOO_MANY_REQUESTS,
            content = {
                "code": "VERIFICATION_CODE_RATE_LIMIT",
                "detail": "Verification code too many requests" 
            }
        )
    
    @app.exception_handler(exceptions.InvalidCredentialsException)
    async def invalid_credentials_handle(
        request: Request,
        exc: exceptions.InvalidCredentialsException
    ):
        return JSONResponse(
            status_code = status.HTTP_401_UNAUTHORIZED,
            content = {
                "code": "INVALID_CREDENTIALS",
                "detail": "Invalid email or password, Please check" 
            }
        )
    
    @app.exception_handler(exceptions.InvalidCookieException)
    async def invalid_cookie_handle(
        request: Request,
        exc: exceptions.InvalidCookieException
    ):
        return JSONResponse(
            status_code = status.HTTP_401_UNAUTHORIZED,
            content = {
                "code": "INVALID_COOKIE",
                "detail": "Cookie is invalid or has expired email, Please log in again" 
            }
        )

    @app.exception_handler(exceptions.LoginRateLimitException)
    async def login_rate_limit_handle(
        request: Request,
        exc: exceptions.LoginRateLimitException
    ):
        return JSONResponse(
            status_code = status.HTTP_429_TOO_MANY_REQUESTS,
            content = {
                "code": "TOO_MANY_REQUESTS",
                "detail": "Too many requests" 
            }
        )