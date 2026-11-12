import secrets
import hmac
import hashlib

from app.config import settings

def hash_rate_limit_subject(
    *,
    scope: str,
    subject: str,
)->str:
    fields = (
        scope,
        subject,
    )

    message = b"".join(
        len(encoded).to_bytes(4, "big") + encoded
        for field in fields
        for encoded in [field.encode("utf-8")]
    )

    return hmac.new(
        settings.rate_limit_hmac_key,
        message,
        hashlib.sha256
    ).hexdigest()

def compare_rate_limit_subject(
    *,
    scope: str,
    subject: str,
    stored_digest: str
)->bool:
    calculated_digest = hash_rate_limit_subject(
        scope=scope,
        subject=subject,
    )

    return hmac.compare_digest(
        calculated_digest,
        stored_digest
    )
