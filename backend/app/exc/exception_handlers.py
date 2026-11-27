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
    
    @app.exception_handler(exceptions.AccountAlreadyInRoomException)
    async def account_already_in_room_handle(
        request: Request,
        exc: exceptions.AccountAlreadyInRoomException
    ):
        return JSONResponse(
            status_code = status.HTTP_409_CONFLICT,
            content = {
                "code": "ACCOUNT_ALREADY_INROOM",
                "detail": "The account already in room" 
            }
        )
    
    @app.exception_handler(exceptions.RoomCodeAllocationFailedException)
    async def room_code_allocation_failed_handle(
        request: Request,
        exc: exceptions.RoomCodeAllocationFailedException
    ):
        return JSONResponse(
            status_code = status.HTTP_503_SERVICE_UNAVAILABLE,
            content = {
                "code": "ROOM_CODE_ALLOCATION_FAILED",
                "detail": "Unable to allocate room code" 
            }
        )
    
    @app.exception_handler(exceptions.RoomNotExistException)
    async def room_not_exist_handle(
        request: Request,
        exc: exceptions.RoomNotExistException
    ):
        return JSONResponse(
            status_code = status.HTTP_404_NOT_FOUND,
            content = {
                "code": "ROOM_NOT_EXIST",
                "detail": "Room does not exist" 
            }
        )
    
    @app.exception_handler(exceptions.RoomStateNotLobbyException)
    async def room_state_not_lobby_handle(
        request: Request,
        exc: exceptions.RoomStateNotLobbyException
    ):
        return JSONResponse(
            status_code = status.HTTP_409_CONFLICT,
            content = {
                "code": "ROOM_STATE_NOT_LOBBY",
                "detail": "The room has already been started or closed" 
            }
        )
    
    @app.exception_handler(exceptions.RoomIsFullException)
    async def room_full_handle(
        request: Request,
        exc: exceptions.RoomIsFullException
    ):
        return JSONResponse(
            status_code = status.HTTP_409_CONFLICT,
            content = {
                "code": "ROOM_IS_FULL",
                "detail": "The room has already been fulled" 
            }
        )
    
    @app.exception_handler(exceptions.RequesterWrongException)
    async def requester_wrong_handle(
        request: Request,
        exc: exceptions.RequesterWrongException
    ):
        return JSONResponse(
            status_code = status.HTTP_403_FORBIDDEN,
            content = {
                "code": "REQUESTER_WRONG",
                "detail": "The requester wrong" 
            }
        )
    
    @app.exception_handler(exceptions.InvalidRequestException)
    async def invalid_request_handle(
        request: Request,
        exc: exceptions.InvalidRequestException
    ):
        return JSONResponse(
            status_code = status.HTTP_403_FORBIDDEN,
            content = {
                "code": "INVALID_REQUEST",
                "detail": "The request is invalid" 
            }
        )

    @app.exception_handler(exceptions.TargetMemberNotExistException)
    async def target_member_not_exist_handle(
        request: Request,
        exc: exceptions.TargetMemberNotExistException
    ):
        return JSONResponse(
            status_code = status.HTTP_404_NOT_FOUND,
            content = {
                "code": "TARGET_MEMBER_NOT_EXIST",
                "detail": "The target member not exist" 
            }
        )
    
    @app.exception_handler(exceptions.GameMembersNotReadyException)
    async def game_members_not_ready_handle(
        request: Request,
        exc: exceptions.GameMembersNotReadyException
    ):
        return JSONResponse(
            status_code = status.HTTP_409_CONFLICT,
            content = {
                "code": "GAME_MEMBERS_NOT_READY",
                "detail": "Some members not ready, please check" 
            }
        )
    
    @app.exception_handler(exceptions.GamePlayerCountInvalidException)
    async def game_player_count_invalid_handle(
        request: Request,
        exc: exceptions.GamePlayerCountInvalidException
    ):
        return JSONResponse(
            status_code = status.HTTP_409_CONFLICT,
            content = {
                "code": "GAME_PLAYER_COUNT_INVALID",
                "detail": "Game player count invalid, please check" 
            }
        )
    
    @app.exception_handler(exceptions.GameNotAccessibleException)
    async def game_not_accessible_handle(
        request: Request,
        exc: exceptions.GameNotAccessibleException
    ):
        return JSONResponse(
            status_code = status.HTTP_409_CONFLICT,
            content = {
                "code": "GAME_NOT_ACCESSIBLE",
                "detail": "Game not accessible"
            }
        )
    
    @app.exception_handler(exceptions.GameAlreadyEndedException)
    async def game_already_ended_handle(
        request: Request,
        exc: exceptions.GameAlreadyEndedException
    ):
        return JSONResponse(
            status_code = status.HTTP_409_CONFLICT,
            content = {
                "code": "GAME_ALREADY_ENDED",
                "detail": "Game already ended"
            }
        )
    
    @app.exception_handler(exceptions.InvalidGameStateException)
    async def game_state_invalid_handle(
        request: Request,
        exc: exceptions.InvalidGameStateException
    ):
        return JSONResponse(
            status_code = status.HTTP_409_CONFLICT,
            content = {
                "code": "GAME_STATE_INVALID",
                "detail": "Game state invalid"
            }
        )
    
    @app.exception_handler(exceptions.InitialPeekExpiredException)
    async def initial_peek_expired_handle(
        request: Request,
        exc: exceptions.InitialPeekExpiredException
    ):
        return JSONResponse(
            status_code = status.HTTP_409_CONFLICT,
            content = {
                "code": "INITIAL_PEEK_EXPIRED",
                "detail": "Initial peek expired"
            }
        )
    
    @app.exception_handler(exceptions.InitialPeekCompletedException)
    async def initial_peek_completed_handle(
        request: Request,
        exc: exceptions.InitialPeekCompletedException
    ):
        return JSONResponse(
            status_code = status.HTTP_409_CONFLICT,
            content = {
                "code": "INITIAL_PEEK_COMPLETED",
                "detail": "Initial peek already completed"
            }
        )
    
    @app.exception_handler(exceptions.InitialPeekNotCompletedException)
    async def initial_peek_not_completed_handle(
        request: Request,
        exc: exceptions.InitialPeekNotCompletedException
    ):
        return JSONResponse(
            status_code = status.HTTP_409_CONFLICT,
            content = {
                "code": "INITIAL_PEEK_NOT_COMPLETED",
                "detail": "Initial peek not completed"
            }
        )
    
    @app.exception_handler(exceptions.InvalidPeekTargetException)
    async def invalid_peek_target_handle(
        request: Request,
        exc: exceptions.InvalidPeekTargetException
    ):
        return JSONResponse(
            status_code = status.HTTP_409_CONFLICT,
            content = {
                "code": "INVALID_PEEK_TARGET",
                "detail": f"Invalid peek target: position = {exc.position}"
            }
        )

    @app.exception_handler(exceptions.RepeatedPeekException)
    async def repeated_peek_handle(
        request: Request,
        exc: exceptions.RepeatedPeekException
    ):
        return JSONResponse(
            status_code = status.HTTP_409_CONFLICT,
            content = {
                "code": "REPEATED_PEEK",
                "detail": f"Repeated peek for position {exc.position}" 
            }
        )
    
    @app.exception_handler(exceptions.InitialPeekCountExceedException)
    async def initial_peek_count_exceed_handle(
        request: Request,
        exc: exceptions.InitialPeekCountExceedException
    ):
        return JSONResponse(
            status_code = status.HTTP_409_CONFLICT,
            content = {
                "code": "INITIAL_PEEK_COUNT_EXCEED",
                "detail": "Initial peek count exceed" 
            }
        )
    
    @app.exception_handler(exceptions.GameTurnAlreadyCreatedException)
    async def game_turn_already_created_handle(
        request: Request,
        exc: exceptions.GameTurnAlreadyCreatedException
    ):
        return JSONResponse(
            status_code = status.HTTP_409_CONFLICT,
            content = {
                "code": "GAME_TURN_ALREADY_CREATED",
                "detail": "Game turn already created" 
            }
        )
    
    @app.exception_handler(exceptions.DrawPileExhaustedException)
    async def drawpile_exhausted_handle(
        request: Request,
        exc: exceptions.DrawPileExhaustedException
    ):
        return JSONResponse(
            status_code = status.HTTP_409_CONFLICT,
            content = {
                "code": "DRAWPILE_EXHAUSTED",
                "detail": "Draw already exhansted" 
            }
        )

    @app.exception_handler(exceptions.GameTurnStateErrorException)
    async def gameturn_state_error_handle(
        request: Request,
        exc: exceptions.GameTurnStateErrorException
    ):
        return JSONResponse(
            status_code = status.HTTP_409_CONFLICT,
            content = {
                "code": "GAMETURN_STATE_ERROR",
                "detail": "Gameturn state error" 
            }
        )
    
    @app.exception_handler(exceptions.GameTurnTimeoutException)
    async def gameturn_timeout_handle(
        request: Request,
        exc: exceptions.GameTurnTimeoutException
    ):
        return JSONResponse(
            status_code = status.HTTP_409_CONFLICT,
            content = {
                "code": "GAMETURN_TIMEOUT",
                "detail": "Gameturn already timeout" 
            }
        )
    
    @app.exception_handler(exceptions.NoDiscardPileException)
    async def no_discardpile_handle(
        request: Request,
        exc: exceptions.NoDiscardPileException
    ):
        return JSONResponse(
            status_code = status.HTTP_409_CONFLICT,
            content = {
                "code": "NO_DISCARDPILE",
                "detail": "No discardpile" 
            }
        )