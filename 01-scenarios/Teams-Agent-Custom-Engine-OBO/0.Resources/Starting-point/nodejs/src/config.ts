/**
 * Configuration for the Microsoft Learn Teams agent.
 *
 * Only the application's *own* settings live here. The Microsoft 365 Agents SDK reads its
 * own configuration straight from the environment through `loadAuthConfigFromEnv`, using the
 * `Connections__ServiceConnection__Settings__…` convention, so those keys are deliberately
 * absent from this model.
 */

// `src/main.ts` imports `./env.js` before anything else, so by the time this module is
// evaluated `.env` has already been read. Importing it here as well is harmless, dotenv is
// idempotent, and it keeps this module usable on its own in a test or a script.
import "./env.js";

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

    /**
     * The chat deployment to reason with. There is no default on purpose: deployment names are
     * chosen when the resource is created, so a guess here would only fail later with a
     * "deployment does not exist" error that points at the wrong place.
     */
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

    /**
     * The Bot Framework channel posts to /api/messages on this port. 3978 is the convention
     * the Azure Bot registration and the dev tunnel are configured for.
     */
    port: number;
}

export const settings: Settings = {
    azureOpenAiEndpoint: required("AZURE_OPENAI_ENDPOINT"),
    azureOpenAiDeployment: required("AZURE_OPENAI_DEPLOYMENT"),
    azureOpenAiApiVersion: optional("AZURE_OPENAI_API_VERSION") ?? "2024-10-21",
    azureOpenAiApiKey: optional("AZURE_OPENAI_API_KEY"),
    azureOpenAiTenantId: optional("AZURE_OPENAI_TENANT_ID"),
    azureOpenAiUseManagedIdentity: optional("AZURE_OPENAI_USE_MANAGED_IDENTITY")?.toLowerCase() === "true",
    learnMcpEndpoint: optional("LEARN_MCP_ENDPOINT") ?? "https://learn.microsoft.com/api/mcp",
    port: Number(optional("PORT") ?? 3978),
};
