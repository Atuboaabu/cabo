from pydantic import BaseModel, Field, ConfigDict

class InitialPeekCommandPayload(BaseModel):
    model_config = ConfigDict(
        strict=True,
        extra="forbid"
    )

    position: int = Field(ge=0, le=3)