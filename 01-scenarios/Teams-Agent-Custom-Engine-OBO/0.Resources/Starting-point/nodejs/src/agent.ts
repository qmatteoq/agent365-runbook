/**
 * The Microsoft Learn research agent: LangChain + Azure OpenAI + Microsoft Learn MCP.
 *
 * This module is deliberately free of any Teams or Agents SDK types. It is the same agent
 * core used by the non-Teams Node.js agent in this repo, which keeps the interesting diff
 * between the two samples confined to the hosting layer.
 */

import {
    AzureCliCredential,
    DefaultAzureCredential,
    getBearerTokenProvider,
    type TokenCredential,
} from "@azure/identity";
import { MemorySaver } from "@langchain/langgraph";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { AzureChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";

import type { Settings } from "./config.js";

const AZURE_OPENAI_SCOPE = "https://cognitiveservices.azure.com/.default";

const SYSTEM_PROMPT = [
    "You are a Microsoft ecosystem research assistant. You specialise in answering questions about",
    "Microsoft products and technologies, Azure, Microsoft 365, Power Platform, .NET, Windows,",
    "Microsoft Entra, Copilot, Dynamics 365 and related services.",
    "\nAlways use the Microsoft Learn MCP tools to search and fetch authoritative documentation before",
    "answering, even when you believe you already know the answer. Ground every factual statement in",
    "the content you retrieved and cite the source URLs at the end of your answer.",
    "\nIf the documentation does not cover the question, say so explicitly instead of guessing.",
    "Keep answers clear, concise and structured.",
    "\nYou are talking to the user inside Microsoft Teams, so format answers with short paragraphs",
    "and bullet points rather than long prose, and keep them under roughly 300 words.",
].join(" ");

function buildCredential(settings: Settings): TokenCredential {
    if (settings.azureOpenAiUseManagedIdentity) {
        return new DefaultAzureCredential();
    }

    // Locally there is no IMDS endpoint, so managed identity is skipped entirely and the
    // tenant is pinned on the Azure CLI credential.
    return new AzureCliCredential({ tenantId: settings.azureOpenAiTenantId });
}

/**
 * Build the chat model, preferring Entra credentials over an API key.
 *
 * Key auth is offered because some environments still rely on it, but the key is a bearer
 * secret with no expiry and no per-caller identity. Many tenants disable keys by policy, in
 * which case the credential path below is the only one available.
 */
function buildModel(settings: Settings): AzureChatOpenAI {
    const common = {
        azureOpenAIEndpoint: settings.azureOpenAiEndpoint,
        azureOpenAIApiDeploymentName: settings.azureOpenAiDeployment,
        azureOpenAIApiVersion: settings.azureOpenAiApiVersion,
        temperature: 0,
    };

    if (settings.azureOpenAiApiKey) {
        return new AzureChatOpenAI({ ...common, azureOpenAIApiKey: settings.azureOpenAiApiKey });
    }

    const credential = buildCredential(settings);
    return new AzureChatOpenAI({
        ...common,
        azureADTokenProvider: getBearerTokenProvider(credential, AZURE_OPENAI_SCOPE),
    });
}

/** Wraps the LangChain agent and the Microsoft Learn MCP connection. */
export class LearnAgent {
    private mcpClient?: MultiServerMCPClient;
    private agent?: ReturnType<typeof createAgent>;
    private toolNamesInternal: string[] = [];

    /**
     * The MCP handshake happens on first use rather than at import, so a slow or unreachable
     * Learn endpoint delays the first answer instead of preventing the host from starting.
     * The promise makes concurrent first turns wait for one handshake instead of racing several.
     */
    private starting?: Promise<void>;

    /**
     * Bumped by /reset. It is part of the LangGraph thread id, so incrementing it starts a
     * brand new conversation thread while leaving the old one to be garbage collected, which
     * is simpler and safer than reaching into the checkpointer's internals.
     */
    private readonly generations = new Map<string, number>();

    constructor(private readonly settings: Settings) {}

    get toolNames(): string[] {
        return this.toolNamesInternal;
    }

    get started(): boolean {
        return this.agent !== undefined;
    }

    /** Connect to the Microsoft Learn MCP server and build the agent graph. */
    async start(): Promise<void> {
        this.starting ??= this.startCore();
        await this.starting;
    }

    private async startCore(): Promise<void> {
        this.mcpClient = new MultiServerMCPClient({
            microsoft_learn: {
                transport: "http",
                url: this.settings.learnMcpEndpoint,
            },
        });

        const tools = await this.mcpClient.getTools();
        this.toolNamesInternal = tools.map((tool) => tool.name);
        console.info(
            `Connected to Microsoft Learn MCP server, ${tools.length} tool(s): ${this.toolNamesInternal.join(", ")}`,
        );

        const model = buildModel(this.settings);

        // MemorySaver keeps one conversation per thread_id, which is what gives each Teams
        // chat its multi-turn memory. It is process-local by design: restarting the agent
        // clears every conversation.
        this.agent = createAgent({
            model,
            tools,
            systemPrompt: SYSTEM_PROMPT,
            checkpointer: new MemorySaver(),
        });
    }

    /** Forget the history of one conversation. */
    reset(conversationId: string): void {
        this.generations.set(conversationId, (this.generations.get(conversationId) ?? 0) + 1);
    }

    async ask(conversationId: string, message: string): Promise<string> {
        if (!this.agent) {
            await this.start();
        }

        if (!this.agent) {
            throw new Error("The agent has not been started.");
        }

        const threadId = `${conversationId}#${this.generations.get(conversationId) ?? 0}`;

        const result = await this.agent.invoke(
            { messages: [{ role: "user", content: message }] },
            { configurable: { thread_id: threadId } },
        );

        const last = result.messages.at(-1);
        return last?.text ?? "";
    }
}
