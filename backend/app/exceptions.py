
class InvalidUsernameException(Exception):
    def __init__(self, name: str) -> None:
        self.name = name


class InvalidEmailAddressException(Exception):
    def __init__(self, email: str) -> None:
        self.email = email

class VerificationAttemptLimitExceedException(Exception):
    def __init__(self, email: str) -> None:
        self.email = email