from pwdlib import PasswordHash

password_hash = PasswordHash.recommended()

def hash_password(
    password: str
)->str:
    return password_hash.hash(password)

def verify_password(
    plain_pwd: str,
    hashed_pwd: str
)->bool:
    return password_hash.verify(plain_pwd, hashed_pwd)