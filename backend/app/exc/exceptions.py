
class InvalidUsernameException(Exception):
    def __init__(self, name: str) -> None:
        self.name = name


class InvalidEmailAddressException(Exception):
    def __init__(self, email: str) -> None:
        self.email = email

class VerificationCodeNotMatchException(Exception):
    pass

class UserAccountExistedException(Exception):
    pass

class UserNameConflictException(Exception):
    pass

class EmailSendFailedException(Exception):
    def __init__(self, content: str) -> None:
        self.content = content

class VerificationCodeRateLimitException(Exception):
    pass

class InvalidCredentialsException(Exception):
    pass

class InvalidCookieException(Exception):
    pass

class LoginRateLimitException(Exception):
    pass

class AccountAlreadyInRoomException(Exception):
    pass

class RoomCodeAllocationFailedException(Exception):
    pass

class RoomNotExistException(Exception):
    pass

class RoomStateNotLobbyException(Exception):
    pass

class RoomIsFullException(Exception):
    pass