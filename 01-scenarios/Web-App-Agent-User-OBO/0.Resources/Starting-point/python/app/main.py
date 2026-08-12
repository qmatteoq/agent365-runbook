"""FastAPI host for the Microsoft Learn agent."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.agent import LearnAgent
from app.auth import AuthRequiredError, AuthService
from app.config import settings

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("learn-agent")

STATIC_DIR = Path(__file__).parent / "static"

agent = LearnAgent(settings)
auth_service = AuthService(settings) if settings.entra_sign_in_enabled else None


@asynccontextmanager
async def lifespan(_: FastAPI):
    if auth_service:
        logger.info(
            "Entra sign-in is configured; requesting user tokens for %s.",
            settings.agent_blueprint_scope,
        )
    else:
        logger.info(
            "Entra sign-in is not configured; running anonymously. Fill in the AzureAd settings in .env to enable it."
        )
    # Connect to the Microsoft Learn MCP server and discover its tools once at startup,
    # so every chat turn reuses the same tool list.
    await agent.start()
    logger.info("Listening on http://%s:%d", settings.host, settings.port)
    yield


app = FastAPI(title="Microsoft Learn Agent", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
if auth_service:
    app.include_router(auth_service.router)


class ChatRequest(BaseModel):
    session_id: str = Field(min_length=1)
    message: str = Field(min_length=1)


class ChatResponse(BaseModel):
    reply: str


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/info")
async def info() -> dict[str, object]:
    return {
        "deployment": settings.azure_openai_deployment,
        "learnMcpEndpoint": settings.learn_mcp_endpoint,
        "tools": agent.tool_names,
    }


if not auth_service:

    @app.get("/api/me")
    async def me() -> dict[str, object]:
        return {
            "authenticationConfigured": False,
            "authenticated": False,
            "user": None,
        }


@app.post("/api/chat")
async def chat(request: ChatRequest, http_request: Request) -> ChatResponse:
    if auth_service:
        try:
            auth_service.acquire_user_assertion(http_request)
        except AuthRequiredError as error:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=str(error),
            ) from error

    try:
        reply = await agent.ask(request.session_id, request.message)
    except Exception:
        logger.exception("Chat turn failed")
        return ChatResponse(
            reply="Sorry, something went wrong while researching that. Please try again."
        )

    return ChatResponse(reply=reply)


def run() -> None:
    import uvicorn

    uvicorn.run("app.main:app", host=settings.host, port=settings.port)


if __name__ == "__main__":
    run()
