from sqlalchemy.orm import Session

from app.normalization import normalize_email
from app.security.verification import generate_code, hash_verification_code

def generate_and_send_email_verification_code(
    session: Session,
    email_address: str
):
    normalized_email = 