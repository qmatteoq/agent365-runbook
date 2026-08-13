/**
 * Host for the Microsoft Learn agent as an Agent 365 AI Teammate.
 *
 * The hosting model here is identical to the Teams starting point: the Microsoft 365 Agents
 * SDK owns the channel, authenticates the incoming Bot Framework request, hands the turn to
 * `AgentApplication`, and sends replies back through the connector. Same `/api/messages`,
 * same activity protocol, same adapter.
 *
 * What changes is who plays the part of the bot registration. There is no Azure Bot resource
 * in front of this agent. The Agent 365 blueprint holds the messaging endpoint instead, so
 * `a365 setup all --aiteammate --m365` is what registers this endpoint with Teams.
 *
 * Until that registration happens the agent runs anonymously and the Microsoft 365 Agents
 * Playground talks to it directly over localhost, which is what makes it testable before any
 * onboarding exists.
 */

// This import must stay first. It loads .env into process.env, and the Agents SDK reads its
// connection settings out of the environment as `@microsoft/agents-hosting` is evaluated.
// See the comment in env.ts for what breaks if the order changes.
import "./env.js";

import { Activity, ActivityTypes } from "@microsoft/agents-activity";
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

// startTypingTimer is off here, unlike the Teams starting point. The agentic channel accepts
// only 'event' and 'message' activities, so a typing indicator on an agentic turn comes back
// as HTTP 400. The turn still completes, but the log fills with errors that look like the
// agent is broken when it isn't. Below we send one by hand on non-agentic turns only.
const agentApp = new AgentApplication<TurnState>({
    storage: new MemoryStorage(),
    startTypingTimer: false,
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

    // Researching on Microsoft Learn takes a few seconds, so keep the channel from timing
    // out, but only where a typing indicator is accepted.
    if (!context.activity.isAgenticRequest()) {
        await context.sendActivity(new Activity(ActivityTypes.Typing));
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
        // keeps the SDK's JWT middleware in front of it.
        app.get("/", (_req, res) => {
            res.type("text/plain").send(
                `Microsoft Learn agent is running. MCP tools: ${learnAgent.toolNames.join(", ") || "not yet connected"}`,
            );
        });
    },
});

// Anonymous mode is inferred rather than configured on Node: the SDK's JWT middleware lets an
// unauthenticated activity through when no client id is configured and NODE_ENV is anything
// other than production. That is what the Playground relies on before onboarding, and it is
// also why the warning below is worth printing.
if (!process.env.Connections__ServiceConnection__Settings__ClientId?.trim()) {
    console.warn(
        "Running in anonymous mode: /api/messages is NOT authenticated. This is what lets the " +
            "Agents Playground reach the agent before onboarding. Do not expose it on a public " +
            "tunnel until 'a365 setup all --aiteammate --m365' has filled in the blueprint credentials.",
    );
}

console.info(`Starting the Microsoft Learn AI Teammate agent on port ${settings.port}.`);
