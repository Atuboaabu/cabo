import secrets
import hashlib

def generate_session_token()->tuple[str, str]:
    token = secrets.token_urlsafe(32)

    token_digest = hashlib.sha256(
        token.encode("utf-8")
    ).hexdigest()

    return token, token_digest