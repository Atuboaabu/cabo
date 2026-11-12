from fastapi import Request, HTTPException, status, Depends

from app.config import settings

def require_trusted_origin(
    request: Request
)->None:
    origin = request.headers.get("origin")

    if origin not in settings.allowed_origins:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Untrusted request origin"
        )

OriginCheckDep = Depends(require_trusted_origin)