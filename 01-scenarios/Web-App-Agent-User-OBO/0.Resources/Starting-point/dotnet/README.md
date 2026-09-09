# Starting point: .NET Agent Framework, Blazor web app

> This optional educational sample has no Agent 365 observability code yet. Use the
> [skill-led](../../../3.Runbook.md) or [manual](../../../3.Runbook-Manual.md) guide to add it,
> or apply the same onboarding steps to our own web agent.

A minimal **Microsoft Agent Framework (.NET)** agent, hosted as a Blazor Server web app with a simple
chat UI. There is no Teams hosting, you chat with it directly in the browser.

The app already contains the Microsoft Entra sign-in plumbing that the user OBO path needs, but it
stays dormant until we fill in the Entra app registration and Agent 365 blueprint settings. That lets
us clone the sample and run it at the start of the runbook, before any app registration exists, while
still ending up with the first OBO link the scenario needs later: an access token for the signed-in
user, addressed to the agent blueprint.

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
| Sign-in | Microsoft Identity Web, disabled until `AzureAd` and `Agent365Observability` are configured |

## Configuration

`appsettings.json`:

```json
{
  "AzureOpenAI": {
    "Endpoint": "https://<resource>.openai.azure.com/",
    "Deployment": "gpt-4.1",
    "TenantId": "<tenant of the Azure OpenAI resource>"
  },
  "AzureAd": {
    "Instance": "https://login.microsoftonline.com/",
    "TenantId": "",
    "ClientId": "",
    "ClientSecret": "",
    "CallbackPath": "/signin-oidc"
  },
  "Agent365Observability": {
    "AgentBlueprintId": ""
  },
  "LearnMcp": { "Endpoint": "https://learn.microsoft.com/api/mcp" }
}
```

`AzureOpenAI:TenantId` pins `DefaultAzureCredential` to the tenant that owns the Azure OpenAI
resource. Without it you may get `HTTP 400 – Tenant provided in token does not match resource token`
when your signed-in identity lives in another tenant.

The Entra sign-in settings are intentionally blank in source control. When any required value is blank
or still looks like a placeholder, the app skips the authentication pipeline and runs the chat page
anonymously. After the runbook creates the app registration and the Agent 365 blueprint, we fill in
`AzureAd:TenantId`, `AzureAd:ClientId`, `AzureAd:ClientSecret`, and
`Agent365Observability:AgentBlueprintId`. The app then requests this scope for the signed-in user:
`api://<blueprint-app-id>/access_agent_as_user`.

You need the **Cognitive Services OpenAI User** role on the Azure OpenAI resource.

Key auth is supported as an alternative for Azure OpenAI. Do not put the key in `appsettings.json`,
that file is committed. Use `dotnet user-secrets set "AzureOpenAI:ApiKey" "<key>"` or the
`AzureOpenAI__ApiKey` environment variable. Entra credentials are used whenever no key is set, which
is the recommended path and the only one available in tenants where keys are disabled by policy.

The Entra client secret follows the same rule. Keep the tracked file empty and set the secret outside
source control:

```powershell
dotnet user-secrets set "AzureAd:ClientSecret" "<value>"
```

This writes the secret to the local user secrets store for this project, so the app can read it during
development without putting the value in the repository. In hosted environments, use the
`AzureAd__ClientSecret` environment variable instead.

## Redirect URI

The default `http` launch profile listens on port 5140, so the app registration needs this redirect URI:

```text
http://localhost:5140/signin-oidc
```

That value matches the `AzureAd:CallbackPath` setting in `appsettings.json`. If we run the HTTPS
profile instead, with `dotnet run --launch-profile https`, the app also listens on
`https://localhost:7199`, so we should register `https://localhost:7199/signin-oidc` for that profile.

## Run

```powershell
az login --tenant <tenant of the Azure OpenAI resource>
dotnet run
```

Then open http://localhost:5140. With the Entra settings blank, the app logs that sign-in is not
configured and the chat page opens anonymously. Once the runbook fills in `AzureAd` and
`Agent365Observability`, the same page requires sign-in and shows the signed-in user in the navigation
menu.

## Wrapping up

We can now add the blueprint, agent identity, OBO token exchange and observability. Work IQ server
selection and consent are optional; making those tools callable requires a runtime integration.

Choose the [skill-led runbook](../../../3.Runbook.md) or the
[manual runbook](../../../3.Runbook-Manual.md), which requires no coding assistant.

To compare against the finished, fully instrumented version, see
[`dotnet-agent-no-teams`](https://github.com/qmatteoq/agent365-demos/tree/main/dotnet-agent-no-teams)
in the reference repo.
