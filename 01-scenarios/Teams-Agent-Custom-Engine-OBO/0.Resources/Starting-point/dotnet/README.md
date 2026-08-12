# Starting point: .NET Agent Framework, Teams / M365 Copilot

> This is the **un-instrumented starting point** for the
> [Teams Agent: Custom Engine OBO](../../../3.Runbook.md) scenario. It has no Agent 365 code in
> it at all. That is deliberate. The runbook walks you through adding it.

A research agent that answers questions about the Microsoft ecosystem: Azure, Microsoft 365, Power
Platform, .NET, Microsoft Entra, Copilot, Dynamics 365, grounding every answer in the official
Microsoft Learn documentation through the [Microsoft Learn MCP server](https://learn.microsoft.com/api/mcp).

It is the same agent as the [web app starting point](../../../../Web-App-Agent-User-OBO/0.Resources/Starting-point/dotnet/),
but built on the **Microsoft 365 Agents SDK**, so the same code runs as a **custom engine agent**
in Microsoft Teams and Microsoft 365 Copilot.

## How it works

| Piece | Role |
| --- | --- |
| `Microsoft.Agents.Hosting.AspNetCore` | Hosts the `/api/messages` channel endpoint that Teams, M365 Copilot and the Agents Playground call. |
| `LearnAgent : AgentApplication` | Routes activities: welcome on join, `/reset`, and every other message. |
| `Microsoft.Agents.AI` + Azure OpenAI | Runs the reasoning loop and the tool calls. |
| `ModelContextProtocol` | Connects to the Learn MCP server at startup and exposes its tools to the agent. |
| `ConversationSessionStore` | One `AgentSession` per conversation, so chats are multi-turn. |

## Prerequisites

- .NET 10 SDK
- Access to the Azure OpenAI resource configured in `appsettings.json`, with the
  **Cognitive Services OpenAI User** role. Authentication defaults to `DefaultAzureCredential`,
  so `az login` locally is enough. Key auth is supported as an alternative. Set it with
  `dotnet user-secrets set "AzureOpenAI:ApiKey" "<key>"` or `AzureOpenAI__ApiKey`, never in the
  committed `appsettings.json`.
- Node.js (only for the Agents Playground)

## Run and test locally

The agent runs in **anonymous mode** by default, so no Azure Bot registration is needed to try it.

```powershell
az login --tenant <tenant of the Azure OpenAI resource>
dotnet run
```

The agent listens on `http://localhost:3978`, with the channel endpoint at `/api/messages`.

In a second terminal, start the Microsoft 365 Agents Playground:

```powershell
npm install -g @microsoft/teams-app-test-tool
teamsapptester
```

It opens a chat UI and connects to `http://127.0.0.1:3978/api/messages`. Ask something like
*"What are the authentication options for Azure Container Apps?"* and the agent will research it on
Microsoft Learn and answer with citations.

## Publish to Teams / Microsoft 365 Copilot

The `appPackage` folder contains everything needed to sideload the agent. Its manifest has two
placeholders:

| Placeholder | Value |
| --- | --- |
| `${{TEAMS_APP_ID}}` | Generated for you by `build-app-package.ps1` on the first build, then cached in `teams-app-id.local.json` (gitignored) so later builds reuse it |
| `${{BOT_ID}}` | The **app (client) ID** of your Azure Bot registration |

Then:

1. **Create an Azure Bot** (Azure Portal → *Azure Bot*), single-tenant or multi-tenant, and note its
   app ID and secret.
2. **Expose the agent publicly**: for local debugging, `devtunnel host -p 3978 --allow-anonymous` and
   set the bot's messaging endpoint to `https://<tunnel>/api/messages`.
3. **Enable the Microsoft Teams channel** on the bot.
4. **Fill in `appsettings.json`** → `TokenValidation.Audiences` and `Connections.ServiceConnection.Settings.ClientId`
   with the bot's app ID. Put the secret in user secrets, never in the file:

   ```powershell
   dotnet user-secrets set "Connections:ServiceConnection:Settings:ClientSecret" "<secret>"
   ```

5. **Build and sideload**:

   ```powershell
   ./build-app-package.ps1 -BotId <bot-app-client-id>
   ```

   Upload the resulting `appPackage.zip` in Teams via *Apps → Manage your apps → Upload an app*.

Because the manifest declares `copilotAgents.customEngineAgents` and includes `copilot` in the bot's
scopes, the same package also surfaces the agent inside Microsoft 365 Copilot.

## Configuration

| Setting | Purpose |
| --- | --- |
| `AzureOpenAI:Endpoint` / `Deployment` / `TenantId` | The model the agent reasons with. |
| `LearnMcp:Endpoint` | Microsoft Learn MCP server. |
| `TokenValidation:Audiences` | Empty = anonymous mode. Set to the bot app ID for Teams. |
| `Connections:ServiceConnection` | Outbound credentials used to reply to the channel. |

**No secret belongs in `appsettings.json`.** Use `dotnet user-secrets` or environment variables.


## Next step

This agent is intentionally free of Agent 365 plumbing. The runbook adds onboarding: blueprint, observability,
and Work IQ.

➡️ **[Go to the runbook](../../../3.Runbook.md)**

To compare against the finished, fully instrumented version, see
[`dotnet-agent-teams`](https://github.com/qmatteoq/agent365-demos/tree/main/dotnet-agent-teams)
in the reference repo.
