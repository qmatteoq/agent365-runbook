from __future__ import annotations

import re
from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def normalize_guid(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    if (value.startswith("{") and value.endswith("}")) or (
        value.startswith("(") and value.endswith(")")
    ):
        value = value[1:-1]
    if not re.fullmatch(r"[0-9a-fA-F]{32}|[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", value):
        return None
    return str(UUID(value))


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", frozen=True,
        hide_input_in_errors=True,
    )

    app_environment: str = "Production"
    host: str = "127.0.0.1"
    port: int = Field(default=5168, ge=1, le=65535)
    ingress_mode: Literal["Local", "Entra"] = "Entra"
    ingress_tenant_id: str = ""
    ingress_audience: str = ""
    ingress_required_role: str = "Shipment.Invoke"
    ingress_allowed_callers: dict[str, str] = Field(default_factory=dict)
    ingress_local_signing_key: SecretStr = SecretStr("")
    agent_reasoning_mode: Literal["Stub", "AzureOpenAI"] = "Stub"
    agent_max_remembered_events: int = Field(default=10000, gt=0)
    azure_openai_endpoint: str = ""
    azure_openai_deployment: str = "gpt-4.1"
    azure_openai_api_version: str = "2024-12-01-preview"
    azure_openai_authentication: str = "ManagedIdentity"
    azure_openai_managed_identity_client_id: str = ""
    azure_openai_tenant_id: str = ""
    azure_openai_client_id: str = ""
    azure_openai_client_secret: SecretStr = SecretStr("")
    azure_openai_api_key: SecretStr = SecretStr("")

    @field_validator("port", "agent_max_remembered_events", mode="before")
    @classmethod
    def integer_only(cls, value: object) -> object:
        if type(value) is int or (isinstance(value, str) and re.fullmatch(r"[0-9]+", value)):
            return value
        raise ValueError("Use a whole positive integer.")

    @model_validator(mode="after")
    def validate_configuration(self) -> Settings:
        if self.is_local and self.app_environment.casefold() != "development":
            raise ValueError("Local authentication is allowed only in Development.")
        tenant = normalize_guid(self.ingress_tenant_id)
        audience = normalize_guid(self.ingress_audience)
        if tenant is None or audience is None:
            raise ValueError("INGRESS_TENANT_ID and INGRESS_AUDIENCE must be GUIDs.")
        callers: dict[str, str] = {}
        for caller, name in self.ingress_allowed_callers.items():
            normalized = normalize_guid(caller)
            if normalized is None or not name.strip() or normalized in callers:
                raise ValueError("INGRESS_ALLOWED_CALLERS must map unique caller GUIDs to display names.")
            callers[normalized] = name
        if not callers or not self.ingress_required_role.strip():
            raise ValueError("Configure INGRESS_REQUIRED_ROLE and at least one INGRESS_ALLOWED_CALLERS entry.")
        object.__setattr__(self, "ingress_tenant_id", tenant)
        object.__setattr__(self, "ingress_audience", audience)
        object.__setattr__(self, "ingress_allowed_callers", callers)
        if self.is_local and len(self.ingress_local_signing_key.get_secret_value().encode("utf-8")) < 32:
            raise ValueError("INGRESS_LOCAL_SIGNING_KEY must contain at least 32 UTF-8 bytes.")
        if not self.host.strip():
            raise ValueError("HOST cannot be empty.")
        return self

    @property
    def is_local(self) -> bool:
        return self.ingress_mode == "Local"

    @property
    def issuer(self) -> str:
        return "https://supply-chain.local" if self.is_local else (
            f"https://login.microsoftonline.com/{self.ingress_tenant_id}/v2.0"
        )

    def validate_model(self) -> None:
        required = ["azure_openai_endpoint", "azure_openai_deployment", "azure_openai_api_version"]
        if self.azure_openai_authentication == "ClientSecret":
            required += ["azure_openai_tenant_id", "azure_openai_client_id", "azure_openai_client_secret"]
        elif self.azure_openai_authentication == "ApiKey":
            required += ["azure_openai_api_key"]
        elif self.azure_openai_authentication != "ManagedIdentity":
            raise ValueError("AZURE_OPENAI_AUTHENTICATION must be ManagedIdentity, ClientSecret, or ApiKey.")
        for name in required:
            value = getattr(self, name)
            if isinstance(value, SecretStr):
                value = value.get_secret_value()
            if not value.strip():
                raise ValueError(f"{name.upper()} is required.")
        endpoint = urlsplit(self.azure_openai_endpoint)
        if endpoint.scheme != "https" or not endpoint.hostname or endpoint.username or endpoint.password:
            raise ValueError("AZURE_OPENAI_ENDPOINT must be an HTTPS endpoint without credentials.")
