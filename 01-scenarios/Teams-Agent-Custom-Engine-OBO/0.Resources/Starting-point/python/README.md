# Starting point — Python + LangChain, Teams / M365 Copilot

> This is the **un-instrumented starting point** for the
> [Teams Agent — Custom Engine OBO](../../../3.Runbook.md) scenario. It has no Agent 365 code in
> it at all. That is deliberate — the runbook walks you through adding it.

A research agent for the Microsoft ecosystem, grounded in the official
[Microsoft Learn MCP server](https://learn.microsoft.com/api/mcp). It answers
questions about Azure, Microsoft 365, Power Platform, .NET, Entra, Copilot and Dynamics 365,
and cites the documentation it used.

It is the same agent as the [web app starting point](../../../../Web-App-Agent-User-OBO/0.Resources/Starting-point/python/),
but hosted in **Microsoft Teams and Microsoft 365 Copilot** through the **Microsoft 365 Agents
SDK** instead of a standalone web app.

| | |
|---|---|
| Language | Python 3.12 |
| Agent framework | LangChain / LangGraph |
| Hosting | Microsoft 365 Agents SDK (`microsoft-agents-hosting-aiohttp`) |
| Surface | Teams, Microsoft 365 Copilot |
| Model | Azure OpenAI (`gpt-4.1`) |
| Tools | Microsoft Learn MCP server |

## How it fits together

```
Teams / M365 Copilot
        │  Bot Framework activity (JWT signed)
        ▼
Azure Bot  python-agent-teams-bot
        │  https://<dev-tunnel>/api/messages
        ▼
aiohttp host ──► AgentApplication (Agents SDK)  app/main.py
                        │
                        ▼
                 LearnAgent (LangChain)          app/agent.py
                        ├──► Azure OpenAI  gpt-4.1
                        └──► Microsoft Learn MCP  (3 tools)
```

`app/agent.py` contains no Teams or Agents SDK types at all. It is the same agent core as the
non-Teams Python agent, which keeps the meaningful difference between the two samples confined
to the hosting layer.

## Identities

Two separate applications are involved, and conflating them is the most common way to break
this setup:

| Identity | Where it comes from | Job |
|---|---|---|
| Bot channel app | You create it — an Azure Bot registration | Authenticates the Teams channel and signs outbound replies |
| Teams app | You generate a GUID once and keep it stable | Identifies the app in the Teams catalogue |

The bot channel app is a plain single-tenant Entra app, **not** an Agent 365 blueprint. Entra
bars agentic applications from requesting client-credentials tokens (`AADSTS82001`), so a
blueprint cannot authenticate outbound Bot Framework replies. When this agent is onboarded to
Agent 365, the blueprint is added alongside — it never replaces the channel app.

If you plan to run more than one Teams agent in the same tenant, give each its own bot app id
and Teams app id, otherwise installing the second replaces the first.

## Configuration

Copy `.env.example` to `.env` and fill it in. `.env` is gitignored.

The Agents SDK reads its own configuration straight from the environment using a
double-underscore convention, which is why those keys do not appear in `app/config.py`:

```dotenv
CONNECTIONS__SERVICE_CONNECTION__SETTINGS__CLIENTID=<bot channel app id>
CONNECTIONS__SERVICE_CONNECTION__SETTINGS__CLIENTSECRET=<secret>
CONNECTIONS__SERVICE_CONNECTION__SETTINGS__TENANTID=<tenant>
```

Everything else (Azure OpenAI, the MCP endpoint, the port) is ordinary application
configuration bound by `pydantic-settings`.

Azure OpenAI is reached with `AzureCliCredential` locally — run `az login` first — or with a
managed identity when `AZURE_OPENAI_USE_MANAGED_IDENTITY=true` on Azure.

## Running it

Press <kbd>F5</kbd> in VS Code. That syncs dependencies, brings the dev tunnel up, and starts
the agent on the port the tunnel forwards to.

Or by hand:

```powershell
uv sync
devtunnel host python-agent-teams-tunnel      # separate terminal
.\.venv\Scripts\python.exe -m app.main
```

Then sideload `appPackage.zip` in Teams (**Apps → Manage your apps → Upload a custom app**) and
send it a question. Rebuild the package with `.\build-app-package.ps1` after editing the
manifest.

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

**Port 3979.** If you run more than one Teams agent locally, give each its own port.

**The dev tunnel url is not derived from the tunnel name.** The url is only printed while the
tunnel is being hosted — read it, don't guess it. A *named* tunnel keeps its url across
restarts, which is what lets the Azure Bot's messaging endpoint stay valid; an anonymous tunnel
hands out a new url every run and silently breaks the channel.

**Use the x86_64 interpreter on Windows on ARM.** `langchain-openai` pulls in `tiktoken`, which
publishes no `win-arm64` wheel. A native ARM64 CPython therefore tries to build it from Rust
source and fails. `.venv` is created from `C:\Python312-x64\python.exe`, and `tasks.json` pins
the same interpreter so <kbd>F5</kbd> does not regress.

**JWT validation is scoped to the messaging endpoint.** The Agents SDK sample registers
`jwt_authorization_middleware` application-wide, which rejects every request that has no
`Authorization` header — including health probes. Here it is applied to `POST /api/messages`
only; that endpoint is still fully protected.

**The MCP handshake is lazy.** The Agents SDK only provides a running event loop once a turn
arrives, so `LearnAgent.start()` runs on the first message rather than at import. A lock makes
concurrent first turns wait for a single handshake instead of racing several.


## Next step

This agent is intentionally free of Agent 365 plumbing. Onboarding — blueprint, observability,
Work IQ — is what the runbook adds.

➡️ **[Go to the runbook](../../../3.Runbook.md)**

To compare against the finished, fully instrumented version, see
[`python-agent-teams`](https://github.com/qmatteoq/agent365-demos/tree/main/python-agent-teams)
in the reference repo.
