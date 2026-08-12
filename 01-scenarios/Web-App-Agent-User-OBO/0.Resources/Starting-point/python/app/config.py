"""Configuration for the Microsoft Learn agent, loaded from environment / .env."""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    azure_openai_endpoint: str
    azure_openai_deployment: str = "gpt-4.1"
    azure_openai_api_version: str = "2024-10-21"

    # Optional. Leave unset to authenticate with Entra credentials, which is the recommended
    # path and the only one available in tenants where API keys are disabled by policy.
    azure_openai_api_key: str | None = None

    # Tenant that owns the Azure OpenAI resource. A token issued by a different tenant
    # makes Azure OpenAI answer HTTP 400 "Tenant provided in token does not match
    # resource token", so the credential is pinned to it explicitly.
    azure_openai_tenant_id: str | None = None

    # Managed identity only exists on Azure infrastructure; locally there is no IMDS
    # endpoint, so the Azure CLI credential is used instead.
    azure_openai_use_managed_identity: bool = False

    learn_mcp_endpoint: str = "https://learn.microsoft.com/api/mcp"

    azure_ad_tenant_id: str | None = None
    azure_ad_client_id: str | None = None
    azure_ad_client_secret: str | None = None
    azure_ad_redirect_uri: str = "http://localhost:8000/signin-oidc"
    agent_blueprint_id: str | None = Field(
        default=None,
        validation_alias="AGENTS365OBSERVABILITY__AGENTBLUEPRINTID",
    )

    host: str = "localhost"
    port: int = 8000

    @property
    def entra_sign_in_enabled(self) -> bool:
        required_values = [
            self.azure_ad_tenant_id,
            self.azure_ad_client_id,
            self.azure_ad_client_secret,
            self.azure_ad_redirect_uri,
            self.agent_blueprint_id,
        ]
        return all(value is not None and value.strip() for value in required_values)

    @property
    def agent_blueprint_scope(self) -> str:
        blueprint_id = (self.agent_blueprint_id or "").strip()
        if not blueprint_id:
            raise RuntimeError("The agent blueprint id is not configured.")

        return f"api://{blueprint_id}/access_agent_as_user"


settings = Settings()  # type: ignore[call-arg]
