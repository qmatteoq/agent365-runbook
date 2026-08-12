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
    host: optional("HOST") ?? "127.0.0.1",
    port: Number(optional("PORT") ?? 8000),
};
