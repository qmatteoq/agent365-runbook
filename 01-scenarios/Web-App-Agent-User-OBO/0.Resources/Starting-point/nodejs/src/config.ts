/** Configuration for the Microsoft Learn agent, loaded from environment / .env. */

import "dotenv/config";

function required(name: string): string {
    const value = process.env[name]?.trim();

    if (!value) {
        throw new Error(`Missing required setting ${name}. Copy .env.example to .env and fill it in.`);
    }

    return value;
}

function optional(name: string): string | undefined {
    const value = process.env[name]?.trim();
    return value ? value : undefined;
}

export interface Settings {
    azureOpenAiEndpoint: string;
    azureOpenAiDeployment: string;
    azureOpenAiApiVersion: string;

    /**
     * Optional. Leave unset to authenticate with Entra credentials, which is the recommended
     * path and the only one available in tenants where API keys are disabled by policy.
     */
    azureOpenAiApiKey?: string;

    /**
     * Tenant that owns the Azure OpenAI resource. A token issued by a different tenant
     * makes Azure OpenAI answer HTTP 400 "Tenant provided in token does not match
     * resource token", so the credential is pinned to it explicitly.
     */
    azureOpenAiTenantId?: string;

    /**
     * Managed identity only exists on Azure infrastructure; locally there is no IMDS
     * endpoint, so the Azure CLI credential is used instead.
     */
    azureOpenAiUseManagedIdentity: boolean;

    learnMcpEndpoint: string;

    azureAdTenantId?: string;
    azureAdClientId?: string;
    azureAdClientSecret?: string;
    azureAdRedirectUri: string;

    /**
     * Agent blueprint app id, written by the Agent 365 CLI. The environment variable keeps the
     * name the Agent 365 tooling uses, so one file serves both the sign-in and the
     * instrumentation the runbook adds later.
     */
    agentBlueprintId?: string;

    /** True only when every value the sign-in needs is present. */
    readonly entraSignInEnabled: boolean;

    /** The scope the sign-in asks for, derived from the blueprint id. */
    readonly agentBlueprintScope: string;

    host: string;
    port: number;
}

export const settings: Settings = {
    azureOpenAiEndpoint: required("AZURE_OPENAI_ENDPOINT"),
    azureOpenAiDeployment: optional("AZURE_OPENAI_DEPLOYMENT") ?? "gpt-4.1",
    azureOpenAiApiVersion: optional("AZURE_OPENAI_API_VERSION") ?? "2024-10-21",
    azureOpenAiApiKey: optional("AZURE_OPENAI_API_KEY"),
    azureOpenAiTenantId: optional("AZURE_OPENAI_TENANT_ID"),
    azureOpenAiUseManagedIdentity: optional("AZURE_OPENAI_USE_MANAGED_IDENTITY")?.toLowerCase() === "true",
    learnMcpEndpoint: optional("LEARN_MCP_ENDPOINT") ?? "https://learn.microsoft.com/api/mcp",

    azureAdTenantId: optional("AZURE_AD_TENANT_ID"),
    azureAdClientId: optional("AZURE_AD_CLIENT_ID"),
    azureAdClientSecret: optional("AZURE_AD_CLIENT_SECRET"),
    azureAdRedirectUri: optional("AZURE_AD_REDIRECT_URI") ?? "http://localhost:8000/signin-oidc",
    agentBlueprintId: optional("AGENTS365OBSERVABILITY__AGENTBLUEPRINTID"),

    get entraSignInEnabled(): boolean {
        return [
            this.azureAdTenantId,
            this.azureAdClientId,
            this.azureAdClientSecret,
            this.azureAdRedirectUri,
            this.agentBlueprintId,
        ].every((value) => Boolean(value?.trim()));
    },

    get agentBlueprintScope(): string {
        const blueprintId = this.agentBlueprintId?.trim();

        if (!blueprintId) {
            throw new Error("The agent blueprint id is not configured.");
        }

        return `api://${blueprintId}/access_agent_as_user`;
    },

    host: optional("HOST") ?? "localhost",
    port: Number(optional("PORT") ?? 8000),
};
