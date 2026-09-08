from __future__ import annotations

import asyncio
import ipaddress
import time
from typing import Any

import httpx
import jwt

from app.config import Settings, normalize_guid


def is_loopback(host: str | None) -> bool:
    try:
        address = ipaddress.ip_address(host or "")
        if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
            address = address.ipv4_mapped
        return address.is_loopback
    except ValueError:
        return False


class EntraKeys:
    def __init__(self, settings: Settings) -> None:
        self.url = f"https://login.microsoftonline.com/{settings.ingress_tenant_id}/discovery/v2.0/keys"
        self.keys: dict[str, Any] = {}
        self.expires_at = 0.0
        self.lock = asyncio.Lock()

    async def fetch(self) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
            response = await client.get(self.url)
            response.raise_for_status()
            return response.json()

    async def signing_key(self, kid: str) -> Any:
        async with self.lock:
            if time.monotonic() >= self.expires_at or kid not in self.keys:
                document = await self.fetch()
                keys: dict[str, Any] = {}
                for item in document["keys"]:
                    if (
                        item.get("kty") == "RSA"
                        and item.get("use", "sig") == "sig"
                        and item.get("alg", "RS256") == "RS256"
                        and isinstance(item.get("kid"), str)
                    ):
                        keys[item["kid"]] = jwt.PyJWK.from_dict(item, algorithm="RS256").key
                self.keys = keys
                self.expires_at = time.monotonic() + 3600
            if kid not in self.keys:
                raise jwt.InvalidTokenError("Unknown signing key.")
            return self.keys[kid]


class Authenticator:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.jwks = None if settings.is_local else EntraKeys(settings)

    async def authenticate(self, values: list[str]) -> tuple[dict[str, Any] | None, str]:
        if not values or (len(values) == 1 and not values[0].lower().startswith("bearer ")):
            return None, "missing_token"
        if len(values) != 1:
            return None, "invalid_token"
        token = values[0][7:].strip()
        if not token:
            return None, "missing_token"
        try:
            algorithm = "HS256" if self.settings.is_local else "RS256"
            header = jwt.get_unverified_header(token)
            if header.get("alg") != algorithm:
                raise jwt.InvalidTokenError("Wrong algorithm.")
            if self.settings.is_local:
                key = self.settings.ingress_local_signing_key.get_secret_value().encode("utf-8")
            else:
                kid = header.get("kid")
                if not isinstance(kid, str) or not kid:
                    raise jwt.InvalidTokenError("Missing signing key identifier.")
                assert self.jwks is not None
                key = await self.jwks.signing_key(kid)
            claims = jwt.decode(
                token, key, algorithms=[algorithm], issuer=self.settings.issuer,
                audience=self.settings.ingress_audience, leeway=30,
                options={"require": ["exp", "iss", "aud"], "verify_iat": False,
                         "verify_sub": False, "verify_jti": False},
            )
            return claims, ""
        except (jwt.PyJWTError, httpx.HTTPError, ValueError, TypeError, KeyError, AttributeError, OverflowError, RecursionError):
            return None, "invalid_token"


def caller_id(claims: dict[str, Any] | None) -> str | None:
    if claims is None:
        return None
    return normalize_guid(claims.get("azp", claims.get("appid")))


def authorization_failure(claims: dict[str, Any], settings: Settings) -> str | None:
    if any(name in claims for name in ("scp", "upn", "preferred_username", "unique_name")) or claims.get("idtyp") != "app":
        return "app_only_required"
    tenant = claims.get("tid")
    if not isinstance(tenant, str) or tenant.casefold() != settings.ingress_tenant_id.casefold():
        return "wrong_tenant"
    caller = caller_id(claims)
    if caller is None or caller not in settings.ingress_allowed_callers:
        return "caller_not_allowed"
    roles = claims.get("roles", [])
    if not (roles == settings.ingress_required_role or (
        isinstance(roles, list) and settings.ingress_required_role in roles
    )):
        return "missing_role"
    return None


def issue_local_token(settings: Settings) -> str:
    if not settings.is_local:
        raise ValueError("Local tokens cannot be issued in Entra mode.")
    if settings.app_environment.casefold() != "development":
        raise ValueError("Local authentication is allowed only in Development.")
    now = int(time.time())
    return jwt.encode(
        {"iss": settings.issuer, "aud": settings.ingress_audience,
         "tid": settings.ingress_tenant_id, "azp": next(iter(settings.ingress_allowed_callers)),
         "idtyp": "app", "roles": [settings.ingress_required_role], "nbf": now - 5, "exp": now + 3600},
        settings.ingress_local_signing_key.get_secret_value().encode("utf-8"), algorithm="HS256",
    )
