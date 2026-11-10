import secrets
import hmac
import hashlib

from app.config import settings

def generate_code(
    length: int = 6
)->str:
    code_str = "".join(
        str(secrets.randbelow(10))
        for _ in range(length)
    )

    return code_str

def hash_verification_code(
    *,
    code: str,
    normalized_email: str,
    purpose: str
)->bytes:
    fields = (
        code,
        normalized_email,
        purpose,
    )

    message = b"".join(
        len(encoded).to_bytes(4, "big") + encoded
        for field in fields
        for encoded in [field.encode("utf-8")]
    )

    return hmac.new(
        settings.verification_hmac_key,
        message,
        hashlib.sha256
    ).digest()
