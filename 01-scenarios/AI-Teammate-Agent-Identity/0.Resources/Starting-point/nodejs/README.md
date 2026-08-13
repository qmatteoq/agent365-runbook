# Starting point: Node.js + TypeScript + LangChain, AI Teammate

> This is the **un-instrumented starting point** for the
> [AI Teammate: Agent Identity](../../../3.Runbook.md) scenario. It has no Agent 365 code in it
> at all. That is deliberate. The runbook walks you through adding it.

A research agent for the Microsoft ecosystem, grounded in the official
[Microsoft Learn MCP server](https://learn.microsoft.com/api/mcp). It answers questions about
Azure, Microsoft 365, Power Platform, .NET, Entra, Copilot and Dynamics 365, and cites the
documentation it used.

Functionally it is the same agent as the
[Teams starting point](../../../../Teams-Agent-Custom-Engine-OBO/0.Resources/Starting-point/nodejs/),
same stack, same system prompt. The difference is entirely in **how it gets onboarded**: this one
becomes an **AI Teammate**, so it acts under its **own identity** (the Agentic User) rather than
on behalf of the signed-in user.

| | |
|---|---|
| Language | Node.js 20+ / TypeScript |
| Agent framework | LangChain / LangGraph |
| Hosting | Microsoft 365 Agents SDK (`@microsoft/agents-hosting-express`) |
| Surface | Teams, Microsoft 365 Copilot |
| Model | Azure OpenAI (your own chat deployment) |
| Tools | Microsoft Learn MCP server |

> This is the **plain** agent, no Agent 365 registration, observability or Work IQ tools.
> You apply the onboarding afterwards.

## How it fits together

```
Teams / M365 Copilot
        │  Bot Framework activity
        ▼
Express host ──► AgentApplication (Agents SDK)   src/main.ts
                        │
                        ▼
                 LearnAgent (LangChain)          src/agent.ts
                        ├──► Azure OpenAI
                        └──► Microsoft Learn MCP  (3 tools)
```

`src/agent.ts` contains no Teams or Agents SDK types at all. It is the same agent core as the
Teams starting point, which keeps the meaningful difference between the two samples confined to
onboarding rather than to the agent itself.

Conversation memory is per conversation and lives in the process, so restarting the agent clears
every conversation.

## Why there is no Azure Bot registration

This is the biggest structural difference from the Node.js Teams starting point, and it is
deliberate.

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

Because there is no separate bot channel app, none of the Teams sample's identity gotchas apply
here:

| Node.js Teams starting point | This agent |
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
double-underscore convention, which is why those keys do not appear in `src/config.ts`:

```dotenv
Connections__ServiceConnection__Settings__ClientId=
Connections__ServiceConnection__Settings__ClientSecret=
Connections__ServiceConnection__Settings__TenantId=
NODE_ENV=development
```

The three credential keys are empty on purpose. Onboarding fills them in. Unlike the Python
starting point, where a missing `SERVICE_CONNECTION` entry makes `MsalConnectionManager` raise
`ValueError: No service connection configuration provided.` at startup, the Node.js SDK is
relaxed about it: `loadAuthConfigFromEnv` only complains when you ask it for a *named* connection
that has no client id. The keys are listed anyway so that there is somewhere obvious for the CLI's
values to land.

The key names are parsed as `Connections__<id>__Settings__<property>`, so the connection id is one
segment and cannot itself contain a double underscore. That differs from the Python sample, where
the same connection is spelled `CONNECTIONS__SERVICE_CONNECTION__SETTINGS__CLIENTID`, and copying
the Python keys across is the quickest way to get a startup error about no connection being found
in the environment.

Anonymous mode is what lets the agent answer activities that carry no bearer token, which is how
the Agents Playground reaches it before onboarding. On Node.js there is no switch for it. The SDK's
JWT middleware grants anonymous access when **no client id is configured** and `NODE_ENV` is
anything other than `production`, so an empty `ClientId` plus `NODE_ENV=development` is the whole
mechanism. It is inferred rather than declared, which makes it quieter than the .NET starting
point's empty `TokenValidation:Audiences` array or Python's explicit `ANONYMOUS_ALLOWED=true`, and
that is worth remembering when you wonder why the agent suddenly stopped accepting Playground
traffic.

Everything else, meaning Azure OpenAI, the MCP endpoint and the port, is ordinary application
configuration read through the small `required()` and `optional()` helpers in `src/config.ts`.

`AZURE_OPENAI_DEPLOYMENT` has no default on purpose. Deployment names are chosen when the resource
is created, so a guess baked into the sample would only surface later as a "deployment does not
exist" error pointing at the wrong place.

Azure OpenAI is reached locally with `AzureCliCredential` after `az login`, or with a managed
identity when `AZURE_OPENAI_USE_MANAGED_IDENTITY=true` on Azure. Setting `AZURE_OPENAI_API_KEY`
switches to key auth instead; leave it blank to use Entra credentials, which is the recommended
path and the only one available where keys are disabled by policy.

You need the **Cognitive Services OpenAI User** role on the Azure OpenAI resource.

## Running it

The agent runs in anonymous mode, so no registration is needed to try it locally. Press
<kbd>F5</kbd> in VS Code and pick the **Playground (Node.js)** configuration.

Or by hand:

```powershell
az login --tenant <tenant of the Azure OpenAI resource>
npm install
npm start
```

It listens on `http://localhost:3982`, with the channel endpoint at `/api/messages`. `GET /` is a
plain liveness string that also reports which MCP tools have been discovered so far.

In a second terminal, start the Microsoft 365 Agents Playground:

```powershell
npm install -g @microsoft/teams-app-test-tool
teamsapptester
```

The second launch configuration, **Teams, via dev tunnel (Node.js)**, brings a named dev tunnel up
as well. You need it from Phase 1 onward, once there is a blueprint with a messaging endpoint to
point at the tunnel's url.

### Commands

| Command | Effect |
|---|---|
| `/help` | What the agent can do |
| `/reset` | Forget the conversation so far |

## Things worth knowing

**The TypeScript is never compiled.** `npm start` runs `tsx src/main.ts`, which transpiles on the
fly, so there is no build step and no `dist/` folder to keep in step with the sources. Run
`npm run typecheck` when you want the compiler's opinion without producing output.

**`.env` has to be loaded before the SDK is imported.** `src/env.ts` exists only to do
`import "dotenv/config"`, and `src/main.ts` imports it first. The reason is that
`@microsoft/agents-hosting` reads the connection settings while it is being imported rather than
when the server starts, and ES module imports are all evaluated before any of the importing
module's own statements run. A `dotenv.config()` call in the body of `main.ts` would therefore
execute far too late. The same hoisting rule bites again in the runbook, where the observability
distro has to be started from its own module for exactly this reason.

**Port 3982.** The other three samples use 3978, 3979 and 3980, and the Node.js Teams sample also
defaults to 3978, so this one sits at 3982 to stay clear of all of them.

**Anonymous mode has a sharp edge.** With no Azure Bot resource in front of it, the only thing
authenticating inbound activities is this endpoint. An anonymous agent reachable on a public tunnel
will accept any well-formed activity, reach the model and spend tokens, and only fail later when it
tries to reply. Keep the tunnel private until onboarding has filled the credentials in.

**The typing indicator is sent by hand, and only on non-agentic turns.** The Teams starting point
sets `startTypingTimer: true` and lets the SDK take care of it. That does not work here, because
the agentic channel accepts only `event` and `message` activities and answers a typing activity
with HTTP 400. The turn still completes, but the log fills with errors that look like a broken
agent, so `src/main.ts` guards the indicator behind `context.activity.isAgenticRequest()`.

**The liveness route is registered before the messages route.** `startServer` adds
`POST /api/messages` after it calls `beforeListen`, so anything registered in that callback is
matched first. A plain `GET /` is harmless, but a catch-all route there would shadow the channel
endpoint and every message would quietly stop arriving.

**The dev tunnel url is not derived from the tunnel name.** The url is only printed while the
tunnel is being hosted; read it, don't guess it. A *named* tunnel keeps its url across restarts,
which is what lets the registered messaging endpoint stay valid; an anonymous tunnel hands out a
new url every run and silently breaks the channel.

**The MCP handshake is lazy.** `LearnAgent.start()` runs on the first message rather than at
import, and a memoised promise makes concurrent first turns wait for a single handshake instead of
racing several. The agent core stays constructible without doing any network work, which is what
keeps `src/agent.ts` free of hosting concerns.

**LangChain 1.x is pinned.** The 1.x line moved `createAgent` into the `langchain` package itself
and changed the message shapes it returns. The versions in `package.json` are the ones this sample
was written against, so loosening them is the quickest way to get a confusing type error in
`src/agent.ts`.

## Next step

This agent is intentionally free of Agent 365 plumbing. Turning it into an AI Teammate, with
blueprint, observability and Work IQ, is what the runbook does.

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
