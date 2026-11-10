
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