from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

router = APIRouter(
    prefix="/health",
    tags=["health"]
)

@router.get(
    ""
)
def get_health():
    return JSONResponse(
        status_code = status.HTTP_200_OK,
        content = {
            "status": "ok"
        }
    )