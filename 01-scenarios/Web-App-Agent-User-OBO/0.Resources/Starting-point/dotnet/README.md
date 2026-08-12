# Starting point — .NET Agent Framework, Blazor web app

> This is the **un-instrumented starting point** for the
> [Web App Agent — User OBO](../../../3.Runbook.md) scenario. It has no Agent 365 code in it at all.
> That is deliberate — the runbook walks you through adding it.

A minimal **Microsoft Agent Framework (.NET)** agent, hosted as a Blazor Server web app with a simple
chat UI. No Teams hosting — you chat with it directly in the browser.

There's no authentication either: open the app and you're talking to the agent, anonymously. That's
intentional. The OBO path needs a user token addressed to the agent blueprint, and the blueprint
doesn't exist until the runbook registers it, so the sign-in is added in **Step 1-4** rather than
shipped here.

The agent is specialised in the Microsoft ecosystem: it uses the official
[Microsoft Learn MCP server](https://learn.microsoft.com/api/mcp) to search and fetch authoritative
documentation, and grounds every answer in the retrieved content with source URLs.

## Stack

| Piece | Detail |
| --- | --- |
| Framework | .NET 10, Blazor Web App (Interactive Server) |
| Agent | `Microsoft.Agents.AI.OpenAI` (`AsAIAgent`) |
| Model | Azure OpenAI `gpt-4.1`, auth via `DefaultAzureCredential` |
| Tools | Microsoft Learn MCP (`microsoft_docs_search`, `microsoft_code_sample_search`, `microsoft_docs_fetch`) over streamable HTTP |

## Configuration

`appsettings.json`:

```json
{
  "AzureOpenAI": {
    "Endpoint": "https://<resource>.openai.azure.com/",
    "Deployment": "gpt-4.1",
    "TenantId": "<tenant of the Azure OpenAI resource>"
  },
  "LearnMcp": { "Endpoint": "https://learn.microsoft.com/api/mcp" }
}
```

`AzureOpenAI:TenantId` pins `DefaultAzureCredential` to the tenant that owns the Azure OpenAI
resource. Without it you may get `HTTP 400 – Tenant provided in token does not match resource token`
when your signed-in identity lives in another tenant.

You need the **Cognitive Services OpenAI User** role on the Azure OpenAI resource.

Key auth is supported as an alternative. Do not put the key in `appsettings.json` — that file is
committed. Use `dotnet user-secrets set "AzureOpenAI:ApiKey" "<key>"` or the
`AzureOpenAI__ApiKey` environment variable. Entra credentials are used whenever no key is set,
which is the recommended path and the only one available in tenants where keys are disabled by
policy.

## Run

```powershell
az login --tenant <tenant of the Azure OpenAI resource>
dotnet run
```

Then open http://localhost:5140.

## Next step

This agent is intentionally free of Agent 365 plumbing — and of sign-in. Onboarding — agent identity,
blueprint, Entra sign-in, observability, Work IQ — is what the runbook adds.

➡️ **[Go to the runbook](../../../3.Runbook.md)**

To compare against the finished, fully instrumented version, see
[`dotnet-agent-no-teams`](https://github.com/qmatteoq/agent365-demos/tree/main/dotnet-agent-no-teams)
in the reference repo.
