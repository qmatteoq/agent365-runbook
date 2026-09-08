import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "dotenv";
import { ConfigurationError, loadEnvironment, normalizeGuid, readSettings } from "../src/config.js";
import { createLocalToken } from "../src/security.js";
import { CALLER, environment } from "./helpers.js";

test("base defaults are Production and Entra, and incomplete configuration fails closed", () => {
    assert.throws(() => readSettings({}), ConfigurationError);
    const settings = readSettings(environment({ APP_ENVIRONMENT: undefined, INGRESS_MODE: undefined, INGRESS_LOCAL_SIGNING_KEY: undefined }));
    assert.equal(settings.environment, "Production");
    assert.equal(settings.ingress.mode, "Entra");
    assert.equal(settings.host, "localhost");
    assert.equal(settings.port, 5168);
    assert.equal(settings.reasoningMode, "Stub");
    assert.equal(settings.maxRememberedEvents, 10000);
    assert.equal(settings.model, undefined);
});

test("Local requires Development and a 32-byte UTF-8 signing key", async () => {
    for (const APP_ENVIRONMENT of ["Production", "Staging", ""]) {
        assert.throws(() => readSettings(environment({ APP_ENVIRONMENT })), /only in Development/);
    }
    for (const INGRESS_LOCAL_SIGNING_KEY of ["", "x".repeat(31)]) {
        assert.throws(() => readSettings(environment({ INGRESS_LOCAL_SIGNING_KEY })), /32 UTF-8 bytes/);
    }
    assert.doesNotThrow(() => readSettings(environment({ INGRESS_LOCAL_SIGNING_KEY: "é".repeat(16) })));
    const settings = readSettings(environment());
    await assert.rejects(createLocalToken({ ...settings, environment: "Production" }), /only in Development/);
    await assert.rejects(createLocalToken({ ...settings, ingress: { ...settings.ingress, mode: "Entra" } }), /Entra mode/);
});

test("configuration bounds and allowlist types are validated without echoing secrets", () => {
    for (const [key, values] of Object.entries({
        INGRESS_MODE: ["Anonymous", "local"],
        INGRESS_TENANT_ID: ["not-guid", ""],
        INGRESS_AUDIENCE: ["api://wrong", ""],
        INGRESS_REQUIRED_ROLE: [""],
        INGRESS_ALLOWED_CALLERS: ["not-json-secret", "[]", "null", "{}", '{"invalid":"name"}', `{"${CALLER}":null}`],
        PORT: ["0", "-1", "65536", "1.2", "NaN"],
        AGENT_MAX_REMEMBERED_EVENTS: ["0", "-1", "1.5", "2147483648"],
        AGENT_REASONING_MODE: ["fallback", "azure"],
    })) {
        for (const value of values) {
            assert.throws(() => readSettings(environment({ [key]: value })), (error) => {
                assert.ok(error instanceof ConfigurationError, key);
                assert.ok(!error.message.includes("not-json-secret"));
                return true;
            });
        }
    }
});

test("GUID allowlist keys and incoming caller GUID formats normalize", () => {
    const mixed = "aBcDeF01-2345-6789-abCD-0123456789aB";
    for (const form of [mixed, `{${mixed}}`, `(${mixed})`, mixed.replaceAll("-", "")]) {
        assert.equal(normalizeGuid(form), mixed.toLowerCase());
        const settings = readSettings(environment({ INGRESS_ALLOWED_CALLERS: JSON.stringify({ [form]: "Caller" }) }));
        assert.ok(settings.ingress.allowedCallers.has(mixed.toLowerCase()));
    }
    assert.equal(normalizeGuid({}), undefined);
});

test(".env loading does not override the process environment", () => {
    const env: NodeJS.ProcessEnv = { APP_ENVIRONMENT: "Production", INGRESS_MODE: "Entra", PORT: "6000" };
    loadEnvironment(".env.example", env);
    assert.equal(env.APP_ENVIRONMENT, "Production");
    assert.equal(env.INGRESS_MODE, "Entra");
    assert.equal(env.PORT, "6000");
    assert.equal(env.INGRESS_ALLOWED_CALLERS, JSON.stringify({ [CALLER]: "Local SAP middleware" }));
});

test("appending a local key overrides the blank .env.example entry", () => {
    const key = environment().INGRESS_LOCAL_SIGNING_KEY!;
    const env = parse(`${readFileSync(".env.example", "utf8")}\nINGRESS_LOCAL_SIGNING_KEY=${key}\n`);
    const settings = readSettings(env);
    assert.equal(settings.ingress.localSigningKey, key);
    assert.equal(settings.ingress.mode, "Local");
    assert.equal(settings.environment, "Development");
});

test("Azure model configuration has explicit, isolated authentication modes", () => {
    const modelEnv = environment({
        AGENT_REASONING_MODE: "AzureOpenAI", AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com/",
    });
    assert.equal(readSettings(modelEnv).model?.authentication, "ManagedIdentity");
    assert.equal(readSettings(modelEnv).model?.apiVersion, "2024-12-01-preview");
    for (const changes of [
        { AZURE_OPENAI_ENDPOINT: "http://example.invalid" },
        { AZURE_OPENAI_ENDPOINT: "https://secret@example.invalid" },
        { AZURE_OPENAI_AUTHENTICATION: "DefaultAzureCredential" },
        { AZURE_OPENAI_AUTHENTICATION: "ApiKey" },
        { AZURE_OPENAI_AUTHENTICATION: "ClientSecret" },
    ]) assert.throws(() => readSettings({ ...modelEnv, ...changes }), ConfigurationError);
    const model = readSettings({ ...modelEnv, AZURE_OPENAI_AUTHENTICATION: "ApiKey", AZURE_OPENAI_API_KEY: "test-key" }).model!;
    assert.equal(model.apiKey, "test-key");
    assert.equal(model.clientSecret, undefined);
    const ignored = readSettings({ ...modelEnv, AZURE_OPENAI_API_KEY: "ambient-key" }).model!;
    assert.equal(ignored.apiKey, undefined);
});
