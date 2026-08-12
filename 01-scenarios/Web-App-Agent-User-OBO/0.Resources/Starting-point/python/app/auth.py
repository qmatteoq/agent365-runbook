"""Microsoft Entra sign-in for the FastAPI web app."""

from __future__ import annotations

import secrets
from typing import Any

import msal
from fastapi import APIRouter, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse

from app.config import Settings

SESSION_COOKIE_NAME = "learn_agent_session"


class AuthRequiredError(Exception):
    """Raised when the caller needs to sign in again."""


class AuthService:
    """Owns the MSAL app, server-side sessions and sign-in routes."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._router = APIRouter()
        self._sessions: dict[str, dict[str, Any]] = {}
        self._client = msal.ConfidentialClientApplication(
            client_id=settings.azure_ad_client_id,
            client_credential=settings.azure_ad_client_secret,
            authority=f"https://login.microsoftonline.com/{settings.azure_ad_tenant_id}",
        )
        self._register_routes()

    @property
    def router(self) -> APIRouter:
        return self._router

    def _register_routes(self) -> None:
        self._router.add_api_route("/signin", self.signin, methods=["GET"])
        self._router.add_api_route("/signin-oidc", self.signin_oidc, methods=["GET"])
        self._router.add_api_route("/signout", self.signout, methods=["GET"])
        self._router.add_api_route("/api/me", self.me, methods=["GET"])

    def _new_session_id(self) -> str:
        session_id = secrets.token_urlsafe(32)
        self._sessions[session_id] = {}
        return session_id

    def _get_session_id(self, request: Request) -> str | None:
        session_id = request.cookies.get(SESSION_COOKIE_NAME)
        if session_id in self._sessions:
            return session_id

        return None

    def _set_session_cookie(self, response: Response, session_id: str) -> None:
        response.set_cookie(
            SESSION_COOKIE_NAME,
            session_id,
            httponly=True,
            # Entra redirects back from another site, so strict cookies would hide the
            # server-side auth flow from the callback and make the session look lost.
            samesite="lax",
        )

    def _get_session(self, request: Request) -> dict[str, Any] | None:
        session_id = self._get_session_id(request)
        if not session_id:
            return None

        return self._sessions[session_id]

    def _get_account(self, session: dict[str, Any]) -> dict[str, Any] | None:
        account_id = session.get("account_id")
        username = session.get("username")
        if not account_id and not username:
            return None

        accounts = (
            self._client.get_accounts(home_account_id=account_id)
            if account_id
            else self._client.get_accounts(username=username)
        )
        return accounts[0] if accounts else None

    def is_authenticated(self, request: Request) -> bool:
        session = self._get_session(request)
        return bool(session and self._get_account(session))

    def _profile(self, session: dict[str, Any] | None) -> dict[str, str] | None:
        if not session:
            return None

        claims = session.get("claims") or {}
        name = claims.get("name") or claims.get("preferred_username") or "Signed-in user"
        username = claims.get("preferred_username") or claims.get("upn") or ""
        return {"name": name, "username": username}

    async def signin(self, request: Request) -> RedirectResponse:
        session_id = self._get_session_id(request) or self._new_session_id()
        session = self._sessions[session_id]
        # The flow dictionary contains the state, nonce and PKCE verifier that MSAL must
        # validate when Entra redirects back, so it stays in the server-side session.
        flow = self._client.initiate_auth_code_flow(
            scopes=[self._settings.agent_blueprint_scope],
            redirect_uri=self._settings.azure_ad_redirect_uri,
        )
        session["flow"] = flow

        response = RedirectResponse(flow["auth_uri"])
        self._set_session_cookie(response, session_id)
        return response

    async def signin_oidc(self, request: Request) -> RedirectResponse:
        session = self._get_session(request)
        if not session or "flow" not in session:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="The sign-in session was not found. Start again from /signin.",
            )

        result = self._client.acquire_token_by_auth_code_flow(
            session.pop("flow"),
            dict(request.query_params),
        )
        if "error" in result:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=result.get("error_description") or result["error"],
            )

        claims = result.get("id_token_claims", {})
        session["claims"] = claims

        username = claims.get("preferred_username") or claims.get("upn")
        if username:
            session["username"] = username

        accounts = (
            self._client.get_accounts(username=username)
            if username
            else self._client.get_accounts()
        )
        if accounts:
            session["account_id"] = accounts[0]["home_account_id"]
        return RedirectResponse("/")

    async def signout(self, request: Request) -> RedirectResponse:
        session_id = self._get_session_id(request)
        if session_id:
            self._sessions.pop(session_id, None)

        response = RedirectResponse("/")
        response.delete_cookie(SESSION_COOKIE_NAME)
        return response

    async def me(self, request: Request) -> dict[str, object]:
        session = self._get_session(request)
        return {
            "authenticationConfigured": True,
            "authenticated": bool(session and self._get_account(session)),
            "user": self._profile(session),
        }

    def acquire_user_assertion(self, request: Request) -> str:
        """Return a blueprint-scoped access token for the signed-in user."""
        session = self._get_session(request)
        if not session:
            raise AuthRequiredError("Sign in before chatting with the agent.")

        account = self._get_account(session)
        if not account:
            raise AuthRequiredError("Sign in before chatting with the agent.")

        result = self._client.acquire_token_silent(
            [self._settings.agent_blueprint_scope],
            account=account,
        )
        if not result or "access_token" not in result:
            raise AuthRequiredError("Sign in again so the app can get a user assertion.")

        return result["access_token"]
