# Starting point: .NET Agent Framework, AI Teammate

> This is the **un-instrumented starting point** for the
> [AI Teammate: Agent Identity](../../../3.Runbook.md) scenario. It has no Agent 365 code in it
> at all, and no hosting layer yet. That is deliberate. The runbook walks you through adding
> both.

A research agent for the Microsoft ecosystem, grounded in the official
[Microsoft Learn MCP server](https://learn.microsoft.com/api/mcp). It answers questions about
Azure, Microsoft 365, Power Platform, .NET, Entra, Copilot and Dynamics 365, and cites the
documentation it used.

Functionally it is the same agent as the
[Teams starting point](../../../../Teams-Agent-Custom-Engine-OBO/0.Resources/Starting-point/dotnet/),
same stack, same system prompt. The difference is entirely in **how it gets onboarded**: this one
becomes an **AI Teammate**, so it acts under its **own identity** (the Agentic User) rather than
on behalf of the signed-in user.

| | |
|---|---|
| Language | .NET 10 |
| Agent framework | Microsoft Agent Framework (`Microsoft.Agents.AI.OpenAI`) |
| Hosting | Microsoft 365 Agents SDK (`Microsoft.Agents.Hosting.AspNetCore`) |
| Surface | Teams, Microsoft 365 Copilot |
| Model | Azure OpenAI (`gpt-4.1`) |
| Tools | Microsoft Learn MCP server |

> This is the **plain** agent, no Agent 365 registration, observability or WorkIQ tools.
> You apply the onboarding afterwards, and it shows up as the diff from
> `plain/dotnet-agent-teammate` to `main`.

## How it fits together

```
Teams / M365 Copilot
        │  Bot Framework activity
        ▼
ASP.NET Core host ──► LearnAgent : AgentApplication   Agent/LearnAgent.cs
                            │
                            ▼
                     AIAgent (Agent Framework)        Program.cs
                            ├──► Azure OpenAI  gpt-4.1
                            └──► Microsoft Learn MCP  (3 tools)
```

`Agent/ConversationSessionStore.cs` keeps one `AgentSession` per conversation, so chats are
multi-turn. Memory is in-process, so restarting the agent clears every conversation.

## Why there is no Azure Bot registration

This is the biggest structural difference from `dotnet-agent-teams`, and it is deliberate.

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

Because there is no separate bot channel app, none of `dotnet-agent-teams`' identity gotchas
apply here:

| `dotnet-agent-teams` | This agent |
|---|---|
| Bot channel app + blueprint, kept strictly separate | Blueprint only |
| Blueprint can't sign channel replies (`AADSTS82001`) | Not applicable, no channel app to sign as |
| `a365 setup all` overwrites the bot credentials in place | No bot credentials to overwrite |
| Observability exported service-to-service | Agentic User identity |

## Running it

The agent runs in **anonymous mode**, so no registration is needed to try it locally:

```powershell
az login --tenant <tenant of the Azure OpenAI resource>
dotnet run
```

It listens on `http://localhost:3980`, with the channel endpoint at `/api/messages`.
`GET /` is a plain liveness string.

In a second terminal, start the Microsoft 365 Agents Playground:

```powershell
npm install -g @microsoft/teams-app-test-tool
teamsapptester
```

**Port 3980, not 3978 or 3979.** `dotnet-agent-teams` uses 3978 and `python-agent-teams` uses
3979, so all three can run at once.

### Commands

| Command | Effect |
|---|---|
| `/reset` | Forget the conversation so far |

## Configuration

| Setting | Purpose |
|---|---|
| `AzureOpenAI:Endpoint` / `Deployment` / `TenantId` | The model the agent reasons with |
| `LearnMcp:Endpoint` | Microsoft Learn MCP server |
| `TokenValidation:Audiences` | Empty = anonymous mode |

`AzureOpenAI:TenantId` pins `DefaultAzureCredential` to the tenant that owns the resource.
Without it a token from another tenant produces
`HTTP 400: Tenant provided in token does not match resource token`.

You need the **Cognitive Services OpenAI User** role on the Azure OpenAI resource.

Key auth is supported as an alternative, but the key must not go in `appsettings.json`, because that
file is committed. Use `dotnet user-secrets set "AzureOpenAI:ApiKey" "<key>"` or the
`AzureOpenAI__ApiKey` environment variable. Entra credentials are used whenever no key is set,
which is the recommended path and the only one available in tenants where keys are disabled by
policy.

There is deliberately **no `Connections` section** and **no `appPackage/`**. The Agents SDK logs
`No connections found in configuration` at startup and runs fine in anonymous mode; the Agent 365
CLI writes the real connection settings during onboarding, and it also owns `manifest.json`.
`a365 setup all --aiteammate` and `a365 publish` generate and stamp it, so it must not be
hand-written.

## Next step

This agent is intentionally free of Agent 365 plumbing, and has no hosting layer yet. Turning it
into an AI Teammate, with hosting, blueprint, observability and Work IQ, is what the runbook does.

➡️ **[Go to the runbook](../../../3.Runbook.md)**

Some gotchas worth knowing before you start, all hit in practice:

- Omit `--authmode`. `s2s` and `both` are rejected alongside `--aiteammate`; `obo` is accepted
  but warns that it is superfluous, since it is the default for an AI Teammate.
- The CLI derives the blueprint display name as `"<name> Blueprint"` and stamps it into the Teams
  manifest's `name.short`, which is capped at 30 characters. The `--agent-name` you pass must
  therefore be **20 characters or fewer**.
- Reaching Teams requires a tenant admin to approve an agent instance from
  `https://admin.cloud.microsoft/#/agents/all/requested`. That is asynchronous and can take
  minutes to hours, so plan for it rather than assuming something has failed.

To compare against the finished, fully instrumented version, see
[`dotnet-agent-teammate`](https://github.com/qmatteoq/agent365-demos/tree/main/dotnet-agent-teammate)
in the reference repo.
