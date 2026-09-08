import { config as dotenv } from "dotenv";

export class ConfigurationError extends Error {}

export interface IngressSettings {
    mode: "Local" | "Entra";
    tenantId: string;
    audience: string;
    requiredRole: string;
    allowedCallers: ReadonlyMap<string, string>;
    localSigningKey: string;
    issuer: string;
}

export interface ModelSettings {
    endpoint: string;
    deployment: string;
    apiVersion: string;
    authentication: "ManagedIdentity" | "ClientSecret" | "ApiKey";
    managedIdentityClientId?: string;
    tenantId?: string;
    clientId?: string;
    clientSecret?: string;
    apiKey?: string;
}

export interface Settings {
    environment: string;
    host: string;
    port: number;
    ingress: IngressSettings;
    reasoningMode: "Stub" | "AzureOpenAI";
    maxRememberedEvents: number;
    model?: ModelSettings;
}

export function normalizeGuid(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    let text = value.trim();
    if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("(") && text.endsWith(")"))) {
        text = text.slice(1, -1);
    }
    if (/^[a-fA-F0-9]{32}$/.test(text)) {
        text = `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
    }
    return /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/.test(text)
        ? text.toLowerCase() : undefined;
}

export function loadEnvironment(path = ".env", environment: NodeJS.ProcessEnv = process.env): void {
    dotenv({ path, processEnv: environment, override: false, quiet: true });
}

export function readSettings(env: NodeJS.ProcessEnv = process.env): Settings {
    const optional = (name: string) => env[name]?.trim() || undefined;
    const required = (name: string) => {
        const value = optional(name);
        if (!value) throw new ConfigurationError(`${name} is required.`);
        return value;
    };
    const guid = (name: string) => {
        const value = normalizeGuid(required(name));
        if (!value) throw new ConfigurationError(`${name} must be a GUID.`);
        return value;
    };
    const integer = (name: string, fallback: number, maximum: number) => {
        const raw = env[name] ?? String(fallback);
        const value = Number(raw);
        if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
            throw new ConfigurationError(`${name} must be an integer between 1 and ${maximum}.`);
        }
        return value;
    };
    const environment = optional("APP_ENVIRONMENT") ?? "Production";
    const mode = optional("INGRESS_MODE") ?? "Entra";
    if (mode !== "Local" && mode !== "Entra") throw new ConfigurationError("INGRESS_MODE must be Local or Entra.");
    if (mode === "Local" && environment.toLowerCase() !== "development") {
        throw new ConfigurationError("Local authentication is allowed only in Development.");
    }
    const tenantId = guid("INGRESS_TENANT_ID");
    const audience = guid("INGRESS_AUDIENCE");
    const requiredRole = env.INGRESS_REQUIRED_ROLE === undefined ? "Shipment.Invoke" : required("INGRESS_REQUIRED_ROLE");
    const allowedCallers = new Map<string, string>();
    let callers: unknown;
    try {
        callers = JSON.parse(required("INGRESS_ALLOWED_CALLERS"));
    } catch {
        throw new ConfigurationError("INGRESS_ALLOWED_CALLERS must be a JSON object mapping client IDs to display names.");
    }
    if (!callers || typeof callers !== "object" || Array.isArray(callers)) {
        throw new ConfigurationError("INGRESS_ALLOWED_CALLERS must be a JSON object.");
    }
    for (const [id, name] of Object.entries(callers)) {
        const normalized = normalizeGuid(id);
        if (!normalized || typeof name !== "string" || !name.trim() || allowedCallers.has(normalized)) {
            throw new ConfigurationError("INGRESS_ALLOWED_CALLERS needs distinct GUID keys and nonempty display names.");
        }
        allowedCallers.set(normalized, name);
    }
    if (allowedCallers.size === 0) throw new ConfigurationError("Configure at least one INGRESS_ALLOWED_CALLERS entry.");
    const localSigningKey = env.INGRESS_LOCAL_SIGNING_KEY ?? "";
    if (mode === "Local" && Buffer.byteLength(localSigningKey, "utf8") < 32) {
        throw new ConfigurationError("INGRESS_LOCAL_SIGNING_KEY must contain at least 32 UTF-8 bytes.");
    }
    const reasoningMode = optional("AGENT_REASONING_MODE") ?? "Stub";
    if (reasoningMode !== "Stub" && reasoningMode !== "AzureOpenAI") {
        throw new ConfigurationError("AGENT_REASONING_MODE must be Stub or AzureOpenAI.");
    }
    let model: ModelSettings | undefined;
    if (reasoningMode === "AzureOpenAI") {
        const endpoint = required("AZURE_OPENAI_ENDPOINT");
        try {
            const url = new URL(endpoint);
            if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error();
        } catch {
            throw new ConfigurationError("AZURE_OPENAI_ENDPOINT must be an HTTPS URL without credentials, query or fragment.");
        }
        const authentication = optional("AZURE_OPENAI_AUTHENTICATION") ?? "ManagedIdentity";
        if (!["ManagedIdentity", "ClientSecret", "ApiKey"].includes(authentication)) {
            throw new ConfigurationError("AZURE_OPENAI_AUTHENTICATION must be ManagedIdentity, ClientSecret, or ApiKey.");
        }
        model = {
            endpoint,
            deployment: optional("AZURE_OPENAI_DEPLOYMENT") ?? "gpt-4.1",
            apiVersion: optional("AZURE_OPENAI_API_VERSION") ?? "2024-12-01-preview",
            authentication: authentication as ModelSettings["authentication"],
            managedIdentityClientId: optional("AZURE_OPENAI_MANAGED_IDENTITY_CLIENT_ID")
                ? guid("AZURE_OPENAI_MANAGED_IDENTITY_CLIENT_ID") : undefined,
            tenantId: authentication === "ClientSecret" ? guid("AZURE_OPENAI_TENANT_ID") : undefined,
            clientId: authentication === "ClientSecret" ? guid("AZURE_OPENAI_CLIENT_ID") : undefined,
            clientSecret: authentication === "ClientSecret" ? required("AZURE_OPENAI_CLIENT_SECRET") : undefined,
            apiKey: authentication === "ApiKey" ? required("AZURE_OPENAI_API_KEY") : undefined,
        };
    }
    return {
        environment,
        host: optional("HOST") ?? "localhost",
        port: integer("PORT", 5168, 65535),
        ingress: {
            mode, tenantId, audience, requiredRole, allowedCallers, localSigningKey,
            issuer: mode === "Local" ? "https://supply-chain.local" : `https://login.microsoftonline.com/${tenantId}/v2.0`,
        },
        reasoningMode,
        maxRememberedEvents: integer("AGENT_MAX_REMEMBERED_EVENTS", 10000, 2147483647),
        model,
    };
}
