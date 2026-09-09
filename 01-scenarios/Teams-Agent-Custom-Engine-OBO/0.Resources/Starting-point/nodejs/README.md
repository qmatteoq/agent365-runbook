# Starting point: Node.js + TypeScript + LangChain, Teams / M365 Copilot

> This is the **un-instrumented starting point** for the
> [Teams Agent: Custom Engine OBO](../../../3.Runbook.md) scenario. It has no Agent 365 code in
> it at all. That is deliberate. The runbook walks you through adding it.

A research agent for the Microsoft ecosystem, grounded in the official
[Microsoft Learn MCP server](https://learn.microsoft.com/api/mcp). It answers
questions about Azure, Microsoft 365, Power Platform, .NET, Entra, Copilot and Dynamics 365,
and cites the documentation it used.

It is the same agent as the [web app starting point](../../../../Web-App-Agent-User-OBO/0.Resources/Starting-point/nodejs/),
but hosted in **Microsoft Teams and Microsoft 365 Copilot** through the **Microsoft 365 Agents
SDK** instead of a standalone web app.

| | |
|---|---|
| Language | Node.js 20+ / TypeScript |
| Agent framework | LangChain / LangGraph |
| Hosting | Microsoft 365 Agents SDK (`@microsoft/agents-hosting-express`) |
| Surface | Teams, Microsoft 365 Copilot |
| Model | Azure OpenAI (your own chat deployment) |
| Tools | Microsoft Learn MCP server |

## How it fits together

```
Teams / M365 Copilot
        │  Bot Framework activity (JWT signed)
        ▼
Azure Bot  nodejs-agent-teams-bot
        │  https://<dev-tunnel>/api/messages
        ▼
Express host ──► AgentApplication (Agents SDK)   src/main.ts
                        │
                        ▼
                 LearnAgent (LangChain)          src/agent.ts
                        ├──► Azure OpenAI
                        └──► Microsoft Learn MCP  (3 tools)
```

`src/agent.ts` contains no Teams or Agents SDK types at all. It is the same agent core as the
non-Teams Node.js agent, which keeps the meaningful difference between the two samples confined
to the hosting layer.

## Identities

Two separate applications are involved, and conflating them is the most common way to break
this setup:

| Identity | Where it comes from | Job |
|---|---|---|
| Bot channel app | You create it, an Azure Bot registration | Authenticates the Teams channel and signs outbound replies |
| Teams app | Generated for you by `build-app-package.ps1` and cached in `teams-app-id.local.json` | Identifies the app in the Teams catalogue |

The bot channel app is a plain single-tenant Entra app, **not** an Agent 365 blueprint. Entra
bars agentic applications from requesting client-credentials tokens (`AADSTS82001`), so a
blueprint cannot authenticate outbound Bot Framework replies. When this agent is onboarded to
Agent 365, the blueprint is added alongside. It never replaces the channel app.

If you plan to run more than one Teams agent in the same tenant, give each its own bot app id
and Teams app id, otherwise installing the second replaces the first. Since each starting point
caches its own `teams-app-id.local.json` next to its own script, separate copies get separate
ids automatically.

## Configuration

Copy `.env.example` to `.env` and fill it in. `.env` is gitignored.

The Agents SDK reads its own configuration straight from the environment using a
double-underscore convention, which is why those keys do not appear in `src/config.ts`:

```dotenv
Connections__ServiceConnection__Settings__ClientId=<bot channel app id>
Connections__ServiceConnection__Settings__ClientSecret=<secret>
Connections__ServiceConnection__Settings__TenantId=<tenant>
```

The key names are parsed as `Connections__<id>__Settings__<property>`, so the connection id is
one segment and cannot itself contain a double underscore. That differs from the Python sample,
where the same connection is spelled `CONNECTIONS__SERVICE_CONNECTION__SETTINGS__CLIENTID`, and
copying the Python keys across is the quickest way to get a startup error about no connection
being found in the environment.

Everything else, meaning Azure OpenAI, the MCP endpoint and the port, is ordinary application
configuration read through the small `required()` and `optional()` helpers in `src/config.ts`.

`AZURE_OPENAI_DEPLOYMENT` has no default on purpose. Deployment names are chosen when the
resource is created, so a guess baked into the sample would only surface later as a "deployment
does not exist" error pointing at the wrong place.

Azure OpenAI is reached locally with `AzureCliCredential` after `az login`, or with a managed
identity when `AZURE_OPENAI_USE_MANAGED_IDENTITY=true` on Azure. Setting `AZURE_OPENAI_API_KEY`
switches to key auth instead; leave it blank to use Entra credentials, which is the recommended
path and the only one available where keys are disabled by policy.

## Running it

Press <kbd>F5</kbd> in VS Code. That installs dependencies, brings the dev tunnel up, and starts
the agent on the port the tunnel forwards to.

Or by hand:

```powershell
npm install
devtunnel host nodejs-agent-teams-tunnel      # separate terminal
npm start
```

Then sideload `appPackage.zip` in Teams (**Apps → Manage your apps → Upload a custom app**) and
send it a question. Rebuild the package with `.\build-app-package.ps1 -BotId <bot app id>` after
editing the manifest.

`GET /` is an unauthenticated liveness probe. `POST /api/messages` requires a valid Bot
Framework token.

### Commands

| Command | Effect |
|---|---|
| `/help` | What the agent can do |
| `/reset` | Forget the conversation so far |

Conversation memory is per Teams conversation and lives in memory, so restarting the agent
clears every conversation.

## Things worth knowing

**The TypeScript is never compiled.** `npm start` runs `tsx src/main.ts`, which transpiles on the
fly, so there is no build step and no `dist/` folder to keep in step with the sources. Run
`npm run typecheck` when you want the compiler's opinion without producing output.

**`.env` has to be loaded before the SDK is imported.** `src/env.ts` exists only to do
`import "dotenv/config"`, and `src/main.ts` imports it first. The reason is that
`@microsoft/agents-hosting` reads the connection settings while it is being imported rather than
when the server starts, and ES module imports are all evaluated before any of the importing
module's own statements run. A `dotenv.config()` call in the body of `main.ts` would therefore
execute far too late, and the symptom is a server that starts up cleanly, logs `for appId
undefined`, and rejects every message Teams sends it.

**Port 3978.** If you run more than one Teams agent locally, give each its own port, and remember
that the dev tunnel forwards to a specific port number too.

**The dev tunnel url is not derived from the tunnel name.** The url is only printed while the
tunnel is being hosted. Read it, don't guess it. A *named* tunnel keeps its url across
restarts, which is what lets the Azure Bot's messaging endpoint stay valid; an anonymous tunnel
hands out a new url every run and silently breaks the channel.

**The liveness route is registered before the messages route.** `startServer` adds
`POST /api/messages` after it calls `beforeListen`, so anything registered in that callback is
matched first. A plain `GET /` is harmless, but a catch-all route there would shadow the channel
endpoint and every Teams message would quietly stop arriving.

**The MCP handshake is lazy.** `LearnAgent.start()` runs on the first message rather than at
import, and a memoised promise makes concurrent first turns wait for a single handshake instead
of racing several. The agent core stays constructible without doing any network work, which is
what keeps `src/agent.ts` free of hosting concerns.

## Wrapping up

This optional educational sample is ready for Agent 365 registration and instrumentation. Choose
the [skill-led runbook](../../../3.Runbook.md) or the [manual runbook](../../../3.Runbook-Manual.md),
which requires no coding assistant. Both can also be followed with our own Teams agent.

Work IQ selection and consent are optional. The manual guide leaves runtime tool integration
outside its worked implementation.
