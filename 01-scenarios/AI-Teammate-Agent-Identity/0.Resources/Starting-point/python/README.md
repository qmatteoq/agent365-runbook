# Starting point: Python + LangChain, AI Teammate

> This is the **un-instrumented starting point** for the
> [AI Teammate: Agent Identity](../../../3.Runbook.md) scenario. It has no Agent 365 code in it
> at all. That is deliberate. The runbook walks you through adding it.

A research agent for the Microsoft ecosystem, grounded in the official
[Microsoft Learn MCP server](https://learn.microsoft.com/api/mcp). It answers questions about
Azure, Microsoft 365, Power Platform, .NET, Entra, Copilot and Dynamics 365, and cites the
documentation it used.

Functionally it is the same agent as the
[Teams starting point](../../../../Teams-Agent-Custom-Engine-OBO/0.Resources/Starting-point/python/),
same stack, same system prompt. The difference is entirely in **how it gets onboarded**: this one
becomes an **AI Teammate**, so it acts under its **own identity** (the Agentic User) rather than
on behalf of the signed-in user.

| | |
|---|---|
| Language | Python 3.12 |
| Agent framework | LangChain / LangGraph |
| Hosting | Microsoft 365 Agents SDK (`microsoft-agents-hosting-aiohttp`) |
| Surface | Teams, Microsoft 365 Copilot |
| Model | Azure OpenAI (`gpt-4.1`) |
| Tools | Microsoft Learn MCP server |

> This is the **plain** agent, no Agent 365 registration, observability or Work IQ tools.
> You apply the onboarding afterwards.

## How it fits together

```
Teams / M365 Copilot
        │  Bot Framework activity
        ▼
aiohttp host ──► AgentApplication (Agents SDK)  app/main.py
                        │
                        ▼
                 LearnAgent (LangChain)          app/agent.py
                        ├──► Azure OpenAI  gpt-4.1
                        └──► Microsoft Learn MCP  (3 tools)
```

`app/agent.py` contains no Teams or Agents SDK types at all. It is the same agent core as the
Teams starting point, which keeps the meaningful difference between the two samples confined to
onboarding rather than to the agent itself.

Conversation memory is per conversation and lives in the process, so restarting the agent clears
every conversation.

## Why there is no Azure Bot registration

This is the biggest structural difference from `python-agent-teams`, and it is deliberate.

An AI Teammate's messaging endpoint is registered **on the blueprint**, not on an Azure Bot
resource. `a365 setup all --aiteammate --m365` calls the MCP Platform `createAgentBlueprint`
endpoint, which proxies Teams Graph and sets the bot `callbackUri`, the same value the Teams
Developer Portal shows as **Notification URL**. When the endpoint changes later:

```powershell
a365 setup blueprint --endpoint-only --messaging-endpoint <url>
```

`--endpoint-only` skips blueprint creation and re-registers just the endpoint. `--update-endpoint <url>`
does the same job as part of a fuller blueprint run, so both flags are real. `--m365` is not needed
here on CLI 1.1.214. The command takes the Teams Graph path on its own.

Because there is no separate bot channel app, none of `python-agent-teams`' identity gotchas
apply here:

| `python-agent-teams` | This agent |
|---|---|
| Bot channel app + blueprint, kept strictly separate | Blueprint only |
| Blueprint can't sign channel replies (`AADSTS82001`) | Not applicable, no channel app to sign as |
| `a365 setup all` overwrites the bot credentials in place | No bot credentials to overwrite |
| Observability exported on behalf of the signed-in user | Exported as the Agentic User |

There is also no `appPackage/` and no `build-app-package.ps1`. The Agent 365 CLI owns the Teams
manifest for an AI Teammate: `a365 setup all --aiteammate` and `a365 publish` generate and stamp
it, so it must not be hand-written.

## Configuration

Copy `.env.example` to `.env` and fill it in. `.env` is gitignored.

The Agents SDK reads its own configuration straight from the environment using a
double-underscore convention, which is why those keys do not appear in `app/config.py`:

```dotenv
CONNECTIONS__SERVICE_CONNECTION__SETTINGS__CLIENTID=
CONNECTIONS__SERVICE_CONNECTION__SETTINGS__CLIENTSECRET=
CONNECTIONS__SERVICE_CONNECTION__SETTINGS__TENANTID=
CONNECTIONS__SERVICE_CONNECTION__SETTINGS__ANONYMOUS_ALLOWED=true
```

The three credential keys are empty on purpose. Onboarding fills them in. They still have to be
**present**, though. The Python `MsalConnectionManager` looks for a `SERVICE_CONNECTION` entry and
raises `ValueError: No service connection configuration provided.` when it finds nothing at all.
This is one of the places where the Python SDK is stricter than .NET, which only logs
`No connections found in configuration` and carries on.

`ANONYMOUS_ALLOWED` is what lets the agent answer activities that carry no bearer token, which is
how the Agents Playground reaches it before onboarding. It is the Python equivalent of the empty
`TokenValidation:Audiences` array in the .NET starting point.

Everything else (Azure OpenAI, the MCP endpoint, the port) is ordinary application configuration
bound by `pydantic-settings`.

Azure OpenAI is reached with `AzureCliCredential` locally (run `az login` first), or with a
managed identity when `AZURE_OPENAI_USE_MANAGED_IDENTITY=true` on Azure. Setting
`AZURE_OPENAI_API_KEY` switches to key auth instead; leave it blank to use Entra credentials,
which is the recommended path and the only one available where keys are disabled by policy.

You need the **Cognitive Services OpenAI User** role on the Azure OpenAI resource.

## Running it

The agent runs in anonymous mode, so no registration is needed to try it locally. Press
<kbd>F5</kbd> in VS Code and pick the **Playground** configuration.

Or by hand:

```powershell
az login --tenant <tenant of the Azure OpenAI resource>
uv sync
.\.venv\Scripts\python.exe -m app.main
```

It listens on `http://localhost:3981`, with the channel endpoint at `/api/messages`. `GET /` is a
plain liveness string.

In a second terminal, start the Microsoft 365 Agents Playground:

```powershell
npm install -g @microsoft/teams-app-test-tool
teamsapptester
```

The second launch configuration, **Teams, via dev tunnel**, brings a named dev tunnel up as well.
You need it from Phase 1 onward, once there is a blueprint with a messaging endpoint to point at
the tunnel's url.

### Commands

| Command | Effect |
|---|---|
| `/help` | What the agent can do |
| `/reset` | Forget the conversation so far |

## Things worth knowing

**Port 3981.** The other three samples use 3978, 3979 and 3980, so all four can run at once.

**Anonymous mode has a sharp edge.** With no Azure Bot resource in front of it, the only thing
authenticating inbound activities is this endpoint. An anonymous agent reachable on a public
tunnel will accept any well-formed activity, reach the model and spend tokens, and only fail later
when it tries to reply. Keep the tunnel private until onboarding has filled the credentials in,
then set `ANONYMOUS_ALLOWED` back to `false`.

**Do not skip the JWT middleware to allow anonymous calls.** It is tempting, and it does not work:
the middleware is what attaches a `claims_identity` to the request, and the adapter reads that to
decide whether the turn is anonymous. Skip it and the turn is treated as *authenticated* instead,
the adapter tries to build a real user token client, and the request fails with
`TENANT_ID is not set in the configuration`. `ANONYMOUS_ALLOWED` is the supported switch.

**JWT validation is scoped to the messaging endpoint.** The Agents SDK sample registers
`jwt_authorization_middleware` application-wide, which rejects every request that has no
`Authorization` header, including health probes. Here it is applied to `POST /api/messages` only.

**The dev tunnel url is not derived from the tunnel name.** The url is only printed while the
tunnel is being hosted; read it, don't guess it. A *named* tunnel keeps its url across restarts,
which is what lets the registered messaging endpoint stay valid; an anonymous tunnel hands out a
new url every run and silently breaks the channel.

**Use the x86_64 interpreter on Windows on ARM.** `langchain-openai` pulls in `tiktoken`, which
publishes no `win-arm64` wheel. A native ARM64 CPython therefore tries to build it from Rust
source and fails. `.venv` is created from `C:\Python312-x64\python.exe`, and `tasks.json` pins the
same interpreter so <kbd>F5</kbd> does not regress.

**The MCP handshake is lazy.** The Agents SDK only provides a running event loop once a turn
arrives, so `LearnAgent.start()` runs on the first message rather than at import. A lock makes
concurrent first turns wait for a single handshake instead of racing several.

## Next step

This agent is intentionally free of Agent 365 plumbing. Turning it into an AI Teammate, with blueprint,
observability and Work IQ, is what the runbook does.

➡️ **[Go to the runbook](../../../3.Runbook.md)**

Some gotchas worth knowing before you start, all hit in practice:

- Omit `--authmode`. `s2s` and `both` are rejected alongside `--aiteammate`; `obo` is accepted but
  warns that it is superfluous, since it is the default for an AI Teammate.
- The CLI derives the blueprint display name as `"<name> Blueprint"` and stamps it into the Teams
  manifest's `name.short`, which is capped at 30 characters. The `--agent-name` you pass must
  therefore be **20 characters or fewer**.
- Reaching Teams requires a tenant admin to approve an agent instance from
  `https://admin.cloud.microsoft/#/agents/all/requested`. That is asynchronous and can take minutes
  to hours, so plan for it rather than assuming something has failed.
