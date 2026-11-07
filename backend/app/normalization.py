import unicodedata
from email_validator import validate_email, EmailNotValidError

from app.exceptions import InvalidEmailAddressException, InvalidUsernameException

def normalize_name(
    name: str
)->tuple[str, str]:
    display_name = name.strip()
    if not display_name:
        raise InvalidUsernameException(name)

    display_name = unicodedata.normalize("NFC", display_name)

    if not 3 <= len(display_name) <= 100:
        raise InvalidUsernameException(name)

    normalized_name = unicodedata.normalize("NFC", display_name.casefold())

    if not 3 <= len(normalized_name) <= 100:
        raise InvalidUsernameException(name)

    return display_name, normalized_name

def normalize_email(
    email: str
)->tuple[str, str]:
    value = email.strip()

    if not value:
        raise InvalidEmailAddressException(email)
    
    try:
        result = validate_email(
            value,
            check_deliverability=False,
        )
    except EmailNotValidError:
        raise InvalidEmailAddressException(email)
    
    domain = result.domain
    local_part = result.local_part
    
    display_email = f"{local_part}@{domain}"
    normalized_email = display_email.casefold()
    return display_email, normalized_email
