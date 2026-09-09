# Starting point: Python S2S supply-chain agent

We're starting with a FastAPI webhook that processes shipment exceptions. It validates a machine caller, reads an order and inventory, produces an operations summary, and invokes notification and ticket tools. LangChain `AzureChatOpenAI` can produce the summary when we enable model reasoning. The host still controls the same read-order, read-inventory, reason, notify, ticket sequence as the [.NET starting point](../dotnet/README.md).

We can run the local exercise without Azure resources. All four tools are in-memory stubs, and the default reasoner produces the same deterministic summary as .NET. This project has no Agent 365 registration, token exchange, telemetry exporter or instrumentation. We add those later through the [S2S runbook](../../../3.Runbook.md).

This is an optional educational sample. The [skill-led](../../../3.Runbook.md) and [manual](../../../3.Runbook-Manual.md) guides can also be applied to our own app-only agent; neither requires this shipment workflow.

## Run locally

We need Python 3.12 or later and `uv`. Use the machine's configured company package registry or proxy for package operations. `uv` doesn't read pip's `pip.ini`; on machines where only pip has the approved feed configured, carry that existing setting into the terminal before using `uv`:

```powershell
$index = (python -m pip config get global.index-url).Trim()
if ($LASTEXITCODE -ne 0 -or -not $index) { throw "The approved pip package source could not be read." }
$env:UV_DEFAULT_INDEX = $index
```

This uses the configured feed without changing global settings. Use the same process setting in any second terminal that runs `uv`; if our organization already configures `uv` itself, keep that configuration instead. From this folder:

```powershell
uv sync --locked --python 3.12 --no-python-downloads
Copy-Item .env.example .env
$key = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
(Get-Content .env) -replace '^INGRESS_LOCAL_SIGNING_KEY=.*$', "INGRESS_LOCAL_SIGNING_KEY=$key" | Set-Content .env
Remove-Variable key
uv run python -m app
```

The sync command uses an installed Python interpreter without downloading another one. The `.env` file selects Development, Local authentication, the fictional tenant and caller IDs, and `http://127.0.0.1:5168`. We generate a signing key locally and keep it in the ignored `.env` file. The host runs one Uvicorn worker and does not trust forwarded client-address headers.

> Keep `.env` out of source control. Copy the example only when creating the file; copying it again replaces any settings we've already entered. If the configured package source cannot provide a dependency, use an approved registry resolution instead of adding a public feed.

In a second terminal in the same folder:

```powershell
$env:S2S_CALLER_TOKEN = (uv run python -m app --issue-local-token).Trim()
uv run python -m app.replay --count 1 --batch-id first-shipment --base-url http://localhost:5168
```

The CLI flag writes one one-hour local token to stdout and exits without starting a server. The replay client reads the token from the environment and sends it as a bearer token. We should see one new run, then one replay if we repeat the command. There is no HTTP endpoint that issues tokens, and the local issuer refuses to run outside Development.

```powershell
uv run python -m app.replay --count 400 --batch-id nightly-demo --base-url http://localhost:5168
uv run python -m app.replay --count 400 --batch-id nightly-demo --base-url http://localhost:5168
Remove-Item Env:S2S_CALLER_TOKEN
```

The first batch submits 400 distinct events and the second resubmits them. The JSON report contains `BatchId`, `Attempts`, `NewRuns`, `Replays`, `Failed`, and `DurationSeconds`. The client refuses redirects, permits HTTP only for loopback origins, and exits with a nonzero status if any request fails. It accepts 1 to 10,000 events and batch IDs containing 1 to 32 ASCII letters, digits, underscores or hyphens. `--delay-ms` accepts 0 to 60,000 milliseconds between attempts.

## Configuration

Environment variables override `.env`. Without local configuration, the app selects Production and Entra and refuses startup until the tenant, audience and allowed callers have been supplied.

| Variable | Meaning |
| --- | --- |
| `APP_ENVIRONMENT` | Defaults to `Production`; Local mode requires `Development` |
| `HOST`, `PORT` | Listener address and port, default `127.0.0.1` and `5168` |
| `INGRESS_MODE` | `Entra` or `Local`, default `Entra` |
| `INGRESS_TENANT_ID` | Expected tenant GUID; also selects the Entra issuer and signing keys |
| `INGRESS_AUDIENCE` | Webhook API application client ID, a GUID for v2 access tokens |
| `INGRESS_REQUIRED_ROLE` | Application role, default `Shipment.Invoke` |
| `INGRESS_ALLOWED_CALLERS` | JSON object mapping caller client IDs to administrator-supplied display names |
| `INGRESS_LOCAL_SIGNING_KEY` | Local signing key, at least 32 UTF-8 bytes |
| `AGENT_REASONING_MODE` | `Stub` or `AzureOpenAI`, default `Stub` |
| `AGENT_MAX_REMEMBERED_EVENTS` | Positive in-memory ledger capacity, default `10000` |
| `AZURE_OPENAI_ENDPOINT` | HTTPS resource endpoint, required only for model reasoning |
| `AZURE_OPENAI_DEPLOYMENT` | Deployment name, default `gpt-4.1` |
| `AZURE_OPENAI_API_VERSION` | API version, default `2024-12-01-preview` |
| `AZURE_OPENAI_AUTHENTICATION` | `ManagedIdentity`, `ClientSecret`, or `ApiKey`, default `ManagedIdentity` |
| `AZURE_OPENAI_MANAGED_IDENTITY_CLIENT_ID` | Optional user-assigned managed identity client ID; empty selects system-assigned |
| `AZURE_OPENAI_TENANT_ID`, `AZURE_OPENAI_CLIENT_ID`, `AZURE_OPENAI_CLIENT_SECRET` | Explicit workload credential for `ClientSecret` mode |
| `AZURE_OPENAI_API_KEY` | Resource key for `ApiKey` mode |

The example contains three fictional GUIDs: tenant `11111111-1111-4111-8111-111111111111`, API `22222222-2222-4222-8222-222222222222`, and caller `33333333-3333-4333-8333-333333333333`. None of them is an Agent 365 identity.

Model credentials and the local signing key have no tracked values. Stub reasoning does not import the model SDK or acquire model credentials. When we enable a model, the process uses only the selected workload credential; it never falls back to an Azure CLI session, interactive sign-in, or `DefaultAzureCredential`. An ambient `AZURE_OPENAI_AD_TOKEN` is rejected because it would let the underlying SDK override the configured credential.

## Use Entra at ingress

We need an API registration and a separate caller registration before replacing the fictional IDs. The [runbook's ingress section](../../../3.Runbook.md#phase-1-protect-the-webhook-with-entra) covers the permission setup alongside the other stacks. The corresponding portal steps are:

1. In the Microsoft Entra admin center, open **App registrations**, choose **New registration**, enter **SupplyChain Webhook API**, select **Accounts in this organizational directory only**, and choose **Register**. Record the **Directory (tenant) ID** and **Application (client) ID**.
2. In **Expose an API**, set the **Application ID URI** to `api://<webhook-api-client-id>`. In **Manifest**, set `api.requestedAccessTokenVersion` to `2`.
3. In **Token configuration**, choose **Add optional claim**, select **Access**, select **idtyp**, and choose **Add**. In **App roles**, create a role with **Display name** `Invoke shipment workflow`, **Allowed member types** **Applications**, **Value** `Shipment.Invoke`, and **Description** `Submit shipment exceptions to the supply-chain webhook`. Keep the role enabled.
4. Create another single-tenant app registration named **SupplyChain Middleware**. In **API permissions**, choose **Add a permission**, **My APIs**, **SupplyChain Webhook API**, **Application permissions**, and `Shipment.Invoke`. Add the permission, then have an administrator grant consent.
5. For a local caller test, open the caller's **Certificates & secrets**, choose **New client secret**, and copy its value to an approved secret store. A deployed caller should use the organization's approved credential method.

These steps give the caller an application permission on the webhook API. They do not register an Agent 365 agent or grant the agent downstream permissions.

```powershell
$env:APP_ENVIRONMENT = "Production"
$env:INGRESS_MODE = "Entra"
$env:INGRESS_TENANT_ID = "<tenant-id>"
$env:INGRESS_AUDIENCE = "<webhook-api-client-id>"
$callerId = "<middleware-client-id>"
$env:INGRESS_ALLOWED_CALLERS = @{ $callerId = "SupplyChain Middleware" } | ConvertTo-Json -Compress
uv run python -m app
```

We replace both the mode and the caller map so the fictional local values cannot authorize a real caller. The validator accepts only RS256 tokens signed by the configured tenant, with its v2 issuer, the configured audience, and a valid expiry. It allows 30 seconds of clock skew and refreshes cached signing keys when a new key ID appears.

The authenticated caller must carry `idtyp=app`, the expected `tid`, the required application role, and an allowed `azp` or `appid`. GUIDs are normalized before the caller lookup and ledger reservation. Tokens containing `scp`, `upn`, `preferred_username`, or `unique_name` are refused even if they also contain the application role.

For a caller using its own client secret, request a token from `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` with `grant_type=client_credentials`, the caller's client ID and secret, and `scope=api://<webhook-api-client-id>/.default`. Put the returned access token in `S2S_CALLER_TOKEN` before using the replay client. The inbound token terminates at the webhook; it is never forwarded to the model or tools.

> A deployed webhook needs HTTPS termination and shared durable replay storage. Local authentication checks the actual socket peer and rejects remote clients regardless of `X-Forwarded-For`. We should not expose the Development listener through a proxy.

## Optional model reasoning

We need an Azure OpenAI resource and a deployed model only when we choose `AzureOpenAI` reasoning. If those resources do not exist:

1. In the Azure portal, choose **Create a resource**, search for **Azure OpenAI**, and choose **Create**. Select our subscription, create a resource group named `rg-s2s-supplychain-demo`, choose a supported region, enter a unique resource name, and select the available pricing tier. Choose **Review + create**, then **Create**.
2. Open the resource in the Foundry portal and create a deployment of an available `gpt-4.1` model with **Deployment name** `gpt-4.1`. The [runbook](../../../3.Runbook.md) includes the resource and deployment walkthrough.
3. Copy the resource's **Endpoint** into `AZURE_OPENAI_ENDPOINT`. For hosted authentication, enable a managed identity on our compute resource, then use the Azure OpenAI resource's **Access control (IAM)** page to assign that identity **Cognitive Services OpenAI User**. Set `AZURE_OPENAI_MANAGED_IDENTITY_CLIENT_ID` only for a user-assigned identity.

The managed identity belongs to our host at this stage. We have not acquired an agent-identity token through Agent 365.

For a local trial where resource-key access is permitted, set these entries in the ignored `.env` file:

```dotenv
AGENT_REASONING_MODE=AzureOpenAI
AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT=gpt-4.1
AZURE_OPENAI_API_VERSION=2024-12-01-preview
AZURE_OPENAI_AUTHENTICATION=ApiKey
AZURE_OPENAI_API_KEY=<resource-key>
```

Restart the host after changing configuration. The model receives the shipment event and the two read results, with instructions to write an operations summary. It receives no inbound bearer token and cannot select or invoke tools. Notification and ticket creation still use stub implementations. Empty model output and model or tool failures produce a failed run with HTTP `500`; there is no fallback to a fabricated success.

> If resource-key access is disabled, keep that policy. Use a managed identity on an Azure host or an approved service principal with **Cognitive Services OpenAI User**. For the service principal, choose `ClientSecret` and configure its tenant, client ID and secret.

## API and retry behavior

`GET /health` returns `{"status":"ok"}` without requiring a token. `POST /api/shipments` accepts:

```json
{
  "sourceEventId": "shipment-exception-1",
  "orderId": "ORDER-1",
  "delayHours": 12
}
```

Event and order IDs accept 1 to 100 ASCII letters, digits, hyphens, underscores, periods or colons. The delay must be an integer between 1 and 720; booleans, strings and floating-point numbers are rejected. Invalid JSON and invalid body shapes return `400`, including cases that FastAPI normally reports as `422`. The 16 KiB body limit also applies to chunked requests, which return `413` when they exceed it. An unsupported content type returns `415`.

We can supply exactly one `X-Correlation-ID` containing 1 to 64 ASCII letters, digits, hyphens, underscores or periods. Invalid or duplicate values return `400` with a generated correlation ID. Every response has the current attempt's correlation header. Authentication happens before correlation rejection so logs can attribute the error to a verified caller; callers whose token has not passed validation remain `unknown`.

| Condition | HTTP status and response |
| --- | --- |
| No bearer token, or failed signature, issuer, audience or lifetime validation | `401`, `missing_token` or `invalid_token` |
| Valid token fails app-only, tenant, caller or role policy | `403`, `app_only_required`, `wrong_tenant`, `caller_not_allowed`, or `missing_role` |
| First accepted event | `200`, `replayed: false` and the run result |
| Same caller, event ID and payload after success | `200`, `replayed: true` and the original result |
| Same event ID with a different payload | `409`, `payload_conflict` |
| Duplicate while its first run is active | `409`, `in_progress` |
| Retry after a failed run | `409`, `failed` |
| New event when the ledger is full | `503`, `capacity_reached` |

A result contains `runId`, `correlationId`, `sourceEventId`, `reasoningMode`, `summary`, `notificationId`, and `ticketId`. A replay returns the original result's correlation ID while the response header identifies the current attempt.

The ledger reserves events atomically under a lock and scopes them by caller and source event ID. It retains completed and failed entries without eviction. A failed run may already have sent a notification, so retrying it does not repeat the workflow. Completed replays continue to work at capacity. State disappears when the single process stops; multiple workers or replicas need shared durable storage and downstream idempotency.

## Check the behavior

```powershell
uv run python -m unittest discover -s tests
```

The tests use Python's standard `unittest` runner and HTTPX's in-process transport. They cover JWT validation, mocked Entra signing-key rotation, app-only policy, socket loopback restrictions, body and correlation limits, concurrent duplicates, retained partial failures, capacity, and 400 events followed by 400 replays. Model-constructor tests mock all three credential choices. The suite does not contact Entra, Azure OpenAI or Agent 365.

Application logs are JSON records with a UTC `Timestamp` and stable fields such as `EventName`, `CallerClientId`, `CallerDisplayName`, `CorrelationId`, `SourceEventId`, and `RunId`. Context follows asynchronous child tasks without leaking into another request. Tool records include `TargetSystem`, `Operation`, `DataScope`, `PermissionMode`, `ToolMode`, `Outcome`, and `DurationMs`. `PermissionMode=none` and `ToolMode=Stub` describe the current tools; neither implies a real downstream write.

## Wrapping up

We now have the machine-authenticated shipment workflow in Python, including its retry boundaries and local simulation. Choose the [skill-led](../../../3.Runbook.md) or [manual](../../../3.Runbook-Manual.md) runbook to register the caller and agent and add observability. The manual route requires no coding assistant. On the skill-led route, the instrumentation prompt is:

```text
Add Agent 365 observability to this agent.
```

The skill adds the instrumentation on that route; the manual guide supplies the commands and source edits to make ourselves. Neither setup is included in this starting point.
