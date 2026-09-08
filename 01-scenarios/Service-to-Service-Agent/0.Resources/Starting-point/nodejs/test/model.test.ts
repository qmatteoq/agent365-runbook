import assert from "node:assert/strict";
import { test } from "node:test";
import { AIMessageChunk } from "@langchain/core/messages";
import { AzureChatOpenAI } from "@langchain/openai";
import type { TokenCredential } from "@azure/identity";
import { readSettings } from "../src/config.js";
import { AzureOpenAIExceptionReasoner, modelOptions, SUMMARY_INSTRUCTIONS, type CredentialFactories } from "../src/reasoner.js";
import { CALLER, TENANT, environment, event } from "./helpers.js";

test("model construction selects only the configured credential and cognitive-services scope", () => {
    const calls: unknown[][] = [];
    const credential: TokenCredential = { async getToken() { throw new Error("No network in tests."); } };
    const factories: CredentialFactories = {
        managedIdentity: (...args) => { calls.push(["ManagedIdentity", ...args]); return credential; },
        clientSecret: (...args) => { calls.push(["ClientSecret", ...args]); return credential; },
        tokenProvider: (value, scope) => {
            assert.equal(value, credential);
            calls.push(["scope", scope]);
            return async () => "mock-token";
        },
    };
    const env = environment({ AGENT_REASONING_MODE: "AzureOpenAI", AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com/" });
    for (const identity of [undefined, CALLER]) {
        calls.length = 0;
        const model = readSettings({ ...env, AZURE_OPENAI_MANAGED_IDENTITY_CLIENT_ID: identity }).model!;
        const options = modelOptions(model, factories);
        assert.deepEqual(calls, [["ManagedIdentity", identity], ["scope", "https://cognitiveservices.azure.com/.default"]]);
        assert.equal(options?.azureOpenAIApiKey, "");
        assert.equal(options?.azureOpenAIApiVersion, "2024-12-01-preview");
        assert.doesNotThrow(() => new AzureChatOpenAI(options));
    }
    calls.length = 0;
    const secret = readSettings({
        ...env, AZURE_OPENAI_AUTHENTICATION: "ClientSecret", AZURE_OPENAI_TENANT_ID: TENANT,
        AZURE_OPENAI_CLIENT_ID: CALLER, AZURE_OPENAI_CLIENT_SECRET: "test-secret",
    }).model!;
    modelOptions(secret, factories);
    assert.deepEqual(calls, [["ClientSecret", TENANT, CALLER, "test-secret"], ["scope", "https://cognitiveservices.azure.com/.default"]]);
    calls.length = 0;
    const apiKey = readSettings({ ...env, AZURE_OPENAI_AUTHENTICATION: "ApiKey", AZURE_OPENAI_API_KEY: "test-key" }).model!;
    const options = modelOptions(apiKey, factories);
    assert.deepEqual(calls, []);
    assert.equal(options?.azureOpenAIApiKey, "test-key");
    assert.equal(options?.azureADTokenProvider, undefined);
    assert.doesNotThrow(() => new AzureChatOpenAI(options));
});

test("LangChain receives only supplied facts and returns text, never a success fallback", async () => {
    const order = { orderId: "ORDER-1", sku: "WIDGET-42", quantity: 20, destination: "Milan" };
    const stock = { sku: "WIDGET-42", availableUnits: 50, warehouse: "Bergamo" };
    const signal = new AbortController().signal;
    const reasoner = new AzureOpenAIExceptionReasoner({
        async invoke(input, options) {
            assert.deepEqual(input, [
                { role: "system", content: SUMMARY_INSTRUCTIONS },
                { role: "user", content: JSON.stringify({ shipment: event, order, inventory: stock }) },
            ]);
            assert.equal(options?.signal, signal);
            return new AIMessageChunk("Assess an alternative shipment.");
        },
    });
    assert.equal(await reasoner.summarize(event, order, stock, signal), "Assess an alternative shipment.");
    for (const content of ["", " \n", [{ type: "image_url", image_url: "unused" }]]) {
        const empty = new AzureOpenAIExceptionReasoner({ async invoke() { return new AIMessageChunk({ content }); } });
        await assert.rejects(empty.summarize(event, order, stock, signal), /empty operations summary/);
    }
    const failed = new AzureOpenAIExceptionReasoner({ async invoke() { throw new Error("Model failed."); } });
    await assert.rejects(failed.summarize(event, order, stock, signal), /Model failed/);
});

test("real LangChain model transport uses the configured endpoint and authentication", async () => {
    const previousKey = process.env.AZURE_OPENAI_API_KEY;
    const previousBasePath = process.env.AZURE_OPENAI_BASE_PATH;
    delete process.env.AZURE_OPENAI_API_KEY;
    process.env.AZURE_OPENAI_BASE_PATH = "https://ignored.example/openai/deployments";
    try {
        for (const authentication of ["ManagedIdentity", "ClientSecret", "ApiKey"]) {
            const settings = readSettings(environment({
                AGENT_REASONING_MODE: "AzureOpenAI", AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com/",
                AZURE_OPENAI_AUTHENTICATION: authentication, AZURE_OPENAI_TENANT_ID: TENANT,
                AZURE_OPENAI_CLIENT_ID: CALLER, AZURE_OPENAI_CLIENT_SECRET: "test-secret",
                AZURE_OPENAI_API_KEY: "explicit-test-key",
            })).model!;
            const credential: TokenCredential = { async getToken() { throw new Error("No Azure calls in tests."); } };
            const options = modelOptions(settings, {
                managedIdentity: () => credential, clientSecret: () => credential,
                tokenProvider: () => async () => "explicit-test-token",
            });
            let requests = 0;
            const model = new AzureChatOpenAI({
                ...options,
                maxRetries: 0,
                configuration: {
                    async fetch(input, init) {
                        requests++;
                        const url = new URL(String(input));
                        assert.equal(url.origin, "https://example.openai.azure.com");
                        assert.equal(url.pathname, "/openai/deployments/gpt-4.1/chat/completions");
                        assert.equal(url.searchParams.get("api-version"), "2024-12-01-preview");
                        const headers = new Headers(init?.headers);
                        if (authentication === "ApiKey") {
                            assert.equal(headers.get("api-key"), "explicit-test-key");
                            assert.equal(headers.get("authorization"), null);
                        } else {
                            assert.equal(headers.get("authorization"), "Bearer explicit-test-token");
                            assert.equal(headers.get("api-key"), null);
                        }
                        return Response.json({
                            id: "chatcmpl-test", object: "chat.completion", created: 1, model: "gpt-4.1",
                            choices: [{ index: 0, message: { role: "assistant", content: "Transport checked." }, finish_reason: "stop" }],
                            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
                        });
                    },
                },
            });
            assert.equal((await model.invoke("Test input.")).content, "Transport checked.");
            assert.equal(requests, 1);
        }
    } finally {
        if (previousKey === undefined) delete process.env.AZURE_OPENAI_API_KEY;
        else process.env.AZURE_OPENAI_API_KEY = previousKey;
        if (previousBasePath === undefined) delete process.env.AZURE_OPENAI_BASE_PATH;
        else process.env.AZURE_OPENAI_BASE_PATH = previousBasePath;
    }
});
