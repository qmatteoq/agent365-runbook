# Starting point: .NET S2S supply-chain agent

We're starting with an ASP.NET Core webhook that processes shipment exceptions. It validates a machine caller, reads an order and inventory, produces an operations summary, and invokes notification and ticket tools. The [S2S runbook](../../../3.Runbook.md) adds Agent 365 registration and observability; this project doesn't contain them yet.

The default is a tenant-free simulation. It uses signed local JWTs and deterministic stub reasoning, with all four tools implemented in memory. Setting `Agent:ReasoningMode` to `AzureOpenAI` enables Microsoft Agent Framework model reasoning, but it doesn't replace the tools or give the process an Agent 365 identity.

## Run locally

We need the .NET 10 SDK and PowerShell 7. From this folder, run:

```powershell
dotnet build
$key = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
dotnet user-secrets set "Ingress:LocalSigningKey" $key
Remove-Variable key
dotnet run --no-build --launch-profile http
```

The `http` profile selects Development and listens at `http://localhost:5168`. Development settings select the local issuer and fictional tenant, API and caller IDs. The random signing key stays in the project's user-secrets store; it is not an Entra credential.

In a second terminal in this folder:

```powershell
$env:ASPNETCORE_ENVIRONMENT = "Development"
$env:S2S_CALLER_TOKEN = (dotnet run --no-build --no-launch-profile -- --issue-local-token).Trim()
.\Invoke-Replay.ps1 -Count 1 -BatchId "first-shipment"
```

The CLI-only flag issues a one-hour local token and exits without starting a second server. The replay script sends it as a bearer token. It should report one new run, and running the same command again should report one replay with no new tool executions. Don't print the token or paste it into an online JWT decoder.

```powershell
.\Invoke-Replay.ps1 -Count 400 -BatchId "nightly-demo"
.\Invoke-Replay.ps1 -Count 400 -BatchId "nightly-demo"
Remove-Item Env:S2S_CALLER_TOKEN
```

The first batch exercises 400 distinct business events and the second resubmits them. The script defaults to 400 when `-Count` is omitted, doesn't follow redirects with credentials, and fails if any response is unsuccessful. Use a new batch ID to generate new events. This is a sequential burst test, not a model of an entire night's arrival pattern; `-DelayMs` can space requests out.

## Configuration

| Key | Meaning |
| --- | --- |
| `Ingress:Mode` | `Local` or `Entra`; base settings default to Entra and fail startup until configured |
| `Ingress:TenantId` | Expected `tid`; in Entra mode, also selects the issuer |
| `Ingress:Audience` | Webhook API application client ID, for a v2 access token |
| `Ingress:RequiredRole` | Application role, default `Shipment.Invoke` |
| `Ingress:AllowedCallers` | Map of caller client IDs to administrator-supplied display names |
| `Ingress:LocalSigningKey` | Local-only signing key, at least 32 bytes; supply via user-secrets or environment |
| `Agent:ReasoningMode` | `Stub` or `AzureOpenAI` |
| `Agent:MaxRememberedEvents` | Capacity of the in-memory event ledger, default 10,000 |
| `AzureOpenAI:Endpoint` | HTTPS Azure OpenAI resource endpoint |
| `AzureOpenAI:Deployment` | Model deployment name, default `gpt-4.1` |
| `AzureOpenAI:Authentication` | `ManagedIdentity`, `ClientSecret`, or `ApiKey` |
| `AzureOpenAI:ManagedIdentityClientId` | Optional user-assigned managed identity client ID; omit for system-assigned |
| `AzureOpenAI:TenantId`, `ClientId`, `ClientSecret` | Explicit workload credential for `ClientSecret` mode |
| `AzureOpenAI:ApiKey` | Secret for the optional `ApiKey` mode |

Environment variable names use double underscores, such as `Ingress__Mode`. The app doesn't load `.env` files. `AzureOpenAI:ApiKey`, `AzureOpenAI:ClientSecret` and `Ingress:LocalSigningKey` have no tracked values.

No credential chain falls back to a developer's Azure CLI session. The runtime uses only the configured noninteractive method. A managed identity used for the model is the host's credential at this stage, not a blueprint-derived agent credential.

## Use Entra at ingress

Follow [Phase 1](../../../3.Runbook.md#phase-1-protect-the-webhook-with-entra) to create the API role and caller assignment. Configure the API to issue v2 tokens and include the `idtyp` access-token claim, then set the real tenant, API audience, and caller map.

```powershell
$env:ASPNETCORE_ENVIRONMENT = "Production"
$env:Ingress__Mode = "Entra"
$env:Ingress__TenantId = "<tenant-id>"
$env:Ingress__Audience = "<webhook-api-client-id>"
dotnet run --no-launch-profile --urls "http://localhost:5168"
```

Configure `Ingress:AllowedCallers` with the real caller ID before running this command. Production avoids the fictional Development allowlist; no local signing key is used. The loopback HTTP listener is for local testing with Entra tokens. A deployed endpoint needs HTTPS termination, trusted proxy configuration where applicable, and durable replay storage.

## Optional model reasoning

The runbook includes Azure resource and model deployment steps. For a local trial with an API key, keep the key in user-secrets:

```powershell
dotnet user-secrets set "AzureOpenAI:Endpoint" "https://<resource>.openai.azure.com/"
dotnet user-secrets set "AzureOpenAI:Deployment" "gpt-4.1"
dotnet user-secrets set "AzureOpenAI:Authentication" "ApiKey"
dotnet user-secrets set "AzureOpenAI:ApiKey" "<resource-key>"
dotnet user-secrets set "Agent:ReasoningMode" "AzureOpenAI"
dotnet run --launch-profile http
```

The model summarizes the event and the two read results. Host code controls notification and ticket creation; generated text cannot select arbitrary tools or authorize a shipment change. Model failures propagate as failed runs instead of falling back to a fabricated success.

> Use a managed identity with **Cognitive Services OpenAI User** for a hosted model connection. If local key access is disabled by policy, use an approved service principal with that role and `ClientSecret` mode, or run on a host with managed identity. We don't weaken the policy by switching to interactive runtime sign-in.

## API and retry behavior

`POST /api/shipments` takes `sourceEventId`, `orderId`, and `delayHours`. Event and order IDs accept up to 100 ASCII letters, digits, hyphens, underscores, periods or colons. The delay must be between 1 and 720 hours, and the body limit is 16 KiB. An optional `X-Correlation-ID` is returned in the response header; otherwise we generate one.

Missing or invalid tokens return `401`. Authenticated callers without the required role, app-only claims or allowlist entry receive `403`. Invalid input returns `400`, while conflicting payloads, active duplicate runs and retries of failed runs return `409`. The [architecture](../../../2.Architecture.md#retries-and-partial-failure) describes the full state table.

A completed replay returns the original run ID and correlation ID in `result`; the response header contains the current attempt's correlation ID. These can differ. The ledger is scoped by caller and source event ID and holds no durable state.

## Local behavior checks

```powershell
.\Test-Local.ps1
```

The script builds the project, starts its own stub host on an available loopback port with an ephemeral signing key, exercises invalid and valid tokens, checks payload and correlation handling, and sends 400 events followed by 400 duplicates. It terminates only the host it started. It doesn't contact Entra, a model, or Agent 365.

## Reading the logs

Application records use `EventName` values such as `ingress.rejected`, `ingress.replay`, `run.started`, `run.ended`, and `tool.ended`. JSON scopes carry `CallerClientId`, `CallerDisplayName`, `CorrelationId`, `SourceEventId`, and `RunId` when those values are known. Tool records include `TargetSystem`, `Operation`, `DataScope`, `DurationMs`, and `Outcome`.

`PermissionMode=none` and `ToolMode=Stub` mean no downstream application permission was exercised. We don't report an agent identity object ID before registration or describe a stub notification as a real Teams message.

## Wrapping up

We can now exercise machine authentication and retries without a tenant. Continue with the [runbook](../../../3.Runbook.md) to register the real caller and agent, add S2S token acquisition, and export the agent's activity.
