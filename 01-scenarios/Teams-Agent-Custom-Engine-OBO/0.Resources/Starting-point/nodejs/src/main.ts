/**
 * Host for the Microsoft Learn agent on Teams and Microsoft 365 Copilot.
 *
 * The Microsoft 365 Agents SDK owns the channel: it authenticates the incoming Bot Framework
 * request, hands the turn to `AgentApplication`, and sends replies back through the connector.
 * This module is only the bridge between a turn and the LangChain agent core in `agent.ts`.
 */

// This import must stay first. It loads .env into process.env, and the Agents SDK reads its
// connection settings out of the environment as `@microsoft/agents-hosting` is evaluated.
// See the comment in env.ts for what breaks if the order changes.
import "./env.js";

import { AgentApplication, MemoryStorage, TurnContext, TurnState } from "@microsoft/agents-hosting";
import { startServer } from "@microsoft/agents-hosting-express";

import { LearnAgent } from "./agent.js";
import { settings } from "./config.js";

const WELCOME = [
    "Hi! I'm the **Microsoft Learn research agent**. Ask me anything about the Microsoft",
    "ecosystem, Azure, Microsoft 365, Power Platform, .NET, Entra, Copilot or Dynamics 365,",
    "and I'll answer from the official Microsoft Learn documentation and cite my sources.",
    "\n\nType `/reset` to start a fresh conversation.",
].join(" ");

const learnAgent = new LearnAgent(settings);

const agentApp = new AgentApplication<TurnState>({
    storage: new MemoryStorage(),
    startTypingTimer: true,
});

async function welcome(context: TurnContext): Promise<void> {
    await context.sendActivity(WELCOME);
}

agentApp.onConversationUpdate("membersAdded", welcome);
agentApp.onMessage("/help", welcome);

agentApp.onMessage("/reset", async (context: TurnContext) => {
    learnAgent.reset(context.activity.conversation?.id ?? "unknown");
    await context.sendActivity("Done, I've forgotten our conversation so far.");
});

agentApp.onActivity("message", async (context: TurnContext) => {
    const question = context.activity.text?.trim();

    if (!question) {
        await context.sendActivity("Ask me a question about the Microsoft ecosystem.");
        return;
    }

    try {
        const answer = await learnAgent.ask(context.activity.conversation?.id ?? "unknown", question);
        await context.sendActivity(answer);
    } catch (error) {
        // A failed turn must not take the channel down: Teams would show a bare
        // "the bot failed to respond" with nothing actionable in it.
        console.error("The agent failed to answer.", error);
        await context.sendActivity("Sorry, something went wrong while researching that. Please try again.");
    }
});

/**
 * Swallow install and uninstall notifications.
 *
 * Teams sends these when the app is added or removed. There is nothing to do, because the
 * welcome message is driven by the membersAdded conversation update instead, but without a
 * route the SDK logs a warning on every install, which is noise in a demo.
 */
agentApp.onActivity("installationUpdate", async () => {});

agentApp.onError(async (_context: TurnContext, error: Error) => {
    console.error("Unhandled agent error.", error);
});

startServer(agentApp, {
    port: settings.port,
    beforeListen: (app) => {
        // An unauthenticated liveness probe. The messages route registered after this callback
        // stays fully protected by the SDK's JWT middleware.
        app.get("/", (_req, res) => {
            res.type("text/plain").send(
                `Microsoft Learn agent is running. MCP tools: ${learnAgent.toolNames.join(", ") || "not yet connected"}`,
            );
        });
    },
});

console.info(`Starting the Microsoft Learn Teams agent on port ${settings.port}.`);
