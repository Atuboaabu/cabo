from fastapi import FastAPI, status
from fastapi.responses import JSONResponse

app = FastAPI()

@app.get(
    "/health"
)
def get_health():
    return JSONResponse(
        status_code = status.HTTP_200_OK,
        content = {
            "status": "ok"
        }
    )