"""Configuration for the Microsoft Learn AI Teammate agent.

Only the *application's own* settings live here. The Microsoft 365 Agents SDK reads its
own configuration straight from the environment via ``load_configuration_from_env`` using
the ``CONNECTIONS__…`` / ``AGENTAPPLICATION__…`` double-underscore convention, so those
keys are deliberately absent from this model.

Unlike the Teams starting point, there are no bot credentials to supply here at all. An
AI Teammate has no Azure Bot registration: the Agent 365 CLI writes the connection
settings onto the blueprint during onboarding.
"""

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

    # 3981 keeps this agent clear of the other three starting points in this repo:
    # 3978 (.NET Teams), 3979 (Python Teams) and 3980 (.NET teammate), so they can all
    # run at the same time.
    port: int = 3981


settings = Settings()  # type: ignore[call-arg]
