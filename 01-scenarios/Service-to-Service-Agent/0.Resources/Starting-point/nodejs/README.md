# Starting point: Node.js S2S supply-chain agent

We're starting with an Express webhook that accepts shipment exceptions from a machine caller. We validate its token, read the order and inventory, produce an operations summary, and call the notification and ticket tools. This is the Node.js version of the [same .NET sample](../dotnet/README.md), with TypeScript interfaces and optional LangChain `AzureChatOpenAI` reasoning.

We can run the entire workflow locally without an Azure subscription. The `.env.example` file selects a local JWT issuer and deterministic stub reasoning, and all four tools return fictional data without contacting another system. Without that configuration, the application defaults to Production and Entra authentication and refuses to start until we supply the ingress settings.

Agent 365 registration and observability come later in the [S2S runbook](../../../3.Runbook.md). This project has no Agent 365 dependencies, OpenTelemetry provider registration, custom metrics, or FMI token service.

This is an optional educational sample. The [skill-led](../../../3.Runbook.md) and [manual](../../../3.Runbook-Manual.md) guides can also be applied to our own app-only agent; neither requires this shipment workflow.

## Run locally

We need Node.js 22 or later and npm. The commands below use PowerShell 7 and run from this folder. We'll generate a signing key on our machine because the sample doesn't ship with a usable secret.

```powershell
npm ci
Copy-Item .env.example .env
$key = node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64'))"
Add-Content .env "`nINGRESS_LOCAL_SIGNING_KEY=$key"
Remove-Variable key
npm run build
npm run dev
```

We install the locked dependencies using npm's existing registry configuration, create an ignored `.env`, and append a random local signing key there. Dotenv uses the last occurrence of a key in the file, so the appended value replaces the template's blank entry. The development command starts a `tsx` watcher at `http://localhost:5168`. Changes to source restart the host and clear its in-memory ledger. `npm start` runs the same TypeScript entry point without watching, while `npm run build` typechecks and compiles the source and tests into `dist`.

In a second terminal in this folder:

```powershell
Invoke-RestMethod http://localhost:5168/health
$env:S2S_CALLER_TOKEN = (npm run --silent token).Trim()
npm run --silent replay -- --count 1 --batch-id first-shipment --base-url http://localhost:5168
npm run --silent replay -- --count 1 --batch-id first-shipment --base-url http://localhost:5168
```

The health endpoint returns `{"status":"ok"}`. The token command reads the same `.env`, writes one JWT to standard output and exits without starting a server. `--silent` suppresses npm's script banner, so we can capture a one-hour token in `S2S_CALLER_TOKEN`. The first replay command reports one new run; the second reports one replay and executes no tools.

> Keep `.env` and the token on our machine. The local signing key is a development secret, not an Entra credential. Don't print bearer tokens or paste them into an online decoder.

```powershell
npm run --silent replay -- --count 400 --batch-id nightly-demo --base-url http://localhost:5168
npm run --silent replay -- --count 400 --batch-id nightly-demo --base-url http://localhost:5168
Remove-Item Env:S2S_CALLER_TOKEN
```

The first batch submits 400 distinct events and the second resubmits the same payloads. The report contains `BatchId`, `Attempts`, `NewRuns`, `Replays`, `Failed`, and `DurationSeconds`. We can use a different batch ID to create new events, or `--delay-ms 100` to space requests out. This is a sequential burst test, not an overnight arrival simulation.

The replay command defaults to 400 events, a random batch ID, zero delay and `http://localhost:5168`. It accepts 1 to 10,000 events, a batch ID of 1 to 32 ASCII letters, digits, underscores or hyphens, and a delay of 0 to 60,000 milliseconds. It reads the bearer token only from `S2S_CALLER_TOKEN`, never follows redirects, requires HTTPS except for loopback origins, and exits with a nonzero status when any attempt fails.

## Configuration

The application and token command load `.env` without replacing existing process environment variables. We use the same names in either place.

| Variable | Meaning and default |
| --- | --- |
| `APP_ENVIRONMENT` | Defaults to `Production`; `Local` ingress requires `Development` |
| `HOST` | Listener host, default `localhost` |
| `PORT` | Listener port, default `5168` |
| `INGRESS_MODE` | `Entra` by default, or `Local` for development |
| `INGRESS_TENANT_ID` | Required tenant GUID; selects the Entra issuer and expected `tid` |
| `INGRESS_AUDIENCE` | Required webhook API application client ID, a GUID |
| `INGRESS_REQUIRED_ROLE` | Application role, default `Shipment.Invoke` |
| `INGRESS_ALLOWED_CALLERS` | Required JSON object mapping caller client IDs to administrator-supplied display names |
| `INGRESS_LOCAL_SIGNING_KEY` | Local signing key with at least 32 UTF-8 bytes; the example leaves it blank |
| `AGENT_REASONING_MODE` | `Stub` by default, or `AzureOpenAI` |
| `AGENT_MAX_REMEMBERED_EVENTS` | Positive ledger capacity, default `10000` |
| `AZURE_OPENAI_ENDPOINT` | HTTPS resource endpoint, required only for model reasoning |
| `AZURE_OPENAI_DEPLOYMENT` | Model deployment name, default `gpt-4.1` |
| `AZURE_OPENAI_API_VERSION` | Default `2024-12-01-preview` |
| `AZURE_OPENAI_AUTHENTICATION` | `ManagedIdentity` by default, or `ClientSecret` or `ApiKey` |
| `AZURE_OPENAI_MANAGED_IDENTITY_CLIENT_ID` | Optional user-assigned identity client ID; blank selects system-assigned identity |
| `AZURE_OPENAI_TENANT_ID`, `AZURE_OPENAI_CLIENT_ID`, `AZURE_OPENAI_CLIENT_SECRET` | Explicit workload credential for `ClientSecret` mode |
| `AZURE_OPENAI_API_KEY` | Resource key for `ApiKey` mode |

GUID caller IDs are normalized before allowlist lookup and ledger reservation. Local tokens use the fictional tenant, webhook API and caller IDs in `.env.example`, matching the .NET sample. Local mode accepts only requests whose actual socket address is loopback. Express has `trust proxy` disabled, so an `X-Forwarded-For` header cannot satisfy that check.

## Use Entra at ingress

We need two app registrations: one representing the webhook API, and one representing the middleware that calls it. Neither is the Agent 365 identity we'll register later.

1. Open the [Microsoft Entra admin center](https://entra.microsoft.com), then **Entra ID**, **App registrations**, and **New registration**. Enter **Name** `SupplyChain Webhook API`, select **Accounts in this organizational directory only**, leave the redirect URI blank, and select **Register**.
2. Copy the API's **Application (client) ID** and **Directory (tenant) ID**. Under **Expose an API**, set **Application ID URI** to `api://<webhook-api-client-id>`.
3. Under **App roles**, select **Create app role**. Enter **Display name** `Invoke shipment workflow`, **Allowed member types** `Applications`, **Value** `Shipment.Invoke`, and **Description** `Submit shipment exceptions to the supply-chain webhook`. Enable the role and select **Apply**.
4. Under **Manifest**, set `api.requestedAccessTokenVersion` to `2` and save. Under **Token configuration**, select **Add optional claim**, choose **Access**, select **idtyp**, and select **Add**.
5. Create another single-tenant registration named `SupplyChain Middleware`, with no redirect URI. Copy its **Application (client) ID**. Under **API permissions**, select **Add a permission**, **My APIs**, and `SupplyChain Webhook API`. Choose **Application permissions**, select `Shipment.Invoke`, add it, and have an authorized administrator grant tenant consent.
6. For a local client-credentials trial, open the middleware's **Certificates & secrets**, select **New client secret**, enter **Description** `Local webhook trial`, choose an expiration permitted by our policy, and select **Add**. Save the secret **Value** in an approved secret store. A hosted middleware should use its approved workload credential.

The [runbook's Entra phase](../../../3.Runbook.md#phase-1-protect-the-webhook-with-entra) explains the role assignment and caller token acquisition. Once those resources exist, we can start this webhook with their IDs:

```powershell
$env:APP_ENVIRONMENT = "Production"
$env:INGRESS_MODE = "Entra"
$env:INGRESS_TENANT_ID = "<tenant-id>"
$env:INGRESS_AUDIENCE = "<webhook-api-client-id>"
$env:INGRESS_ALLOWED_CALLERS = '{"<middleware-client-id>":"SupplyChain Middleware"}'
npm start
```

Replace all three placeholder IDs with the real GUIDs from the registrations. Process environment variables override the fictional values in `.env`, and Entra mode never uses the local signing key. The default loopback listener is suitable for testing with Entra tokens; a deployed webhook needs HTTPS termination and an appropriate bind address.

To acquire a token for the local trial, open another terminal and supply the middleware's credential:

```powershell
$tenantId = "<tenant-id>"
$apiClientId = "<webhook-api-client-id>"
$callerClientId = "<middleware-client-id>"
$secret = Read-Host "Middleware client secret" -MaskInput
try {
    $tokenResponse = Invoke-RestMethod -Method Post `
        -Uri "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/token" `
        -ContentType "application/x-www-form-urlencoded" `
        -Body @{
            client_id = $callerClientId
            client_secret = $secret
            grant_type = "client_credentials"
            scope = "api://$apiClientId/.default"
        }
    $env:S2S_CALLER_TOKEN = $tokenResponse.access_token
} finally {
    Remove-Variable secret
}
npm run --silent replay -- --count 1 --batch-id entra-trial --base-url http://localhost:5168
Remove-Item Env:S2S_CALLER_TOKEN
Remove-Variable tokenResponse
```

This request obtains an application token addressed to the webhook API. It doesn't sign a user into the agent. The webhook validates the RS256 signature with the tenant's JWKS, the exact tenant v2 issuer, the API audience, and an expiration time with 30 seconds of clock skew. It then requires `idtyp=app`, the configured tenant, an allowed `azp` or `appid`, and the application role. Tokens containing `scp`, `upn`, `preferred_username` or `unique_name` are rejected even when they also carry a role.

> Use a credential and consent process approved for our tenant. If we can't create a client secret, follow the runbook with the middleware's existing certificate or workload identity instead of weakening the policy. The webhook has no anonymous fallback or HTTP token-minting endpoint.

## Optional Azure OpenAI reasoning

We only need a model when we want generated summaries. The default stub already exercises authentication, all four tool boundaries and replay handling.

1. In the [Azure portal](https://portal.azure.com), select **Create a resource**, search for **Azure OpenAI**, and select **Create**. Choose our subscription, create a resource group named `rg-s2s-supplychain-demo`, choose an available region, enter a globally unique resource name, and select a pricing tier allowed by our subscription.
2. After deployment, open the resource in the model deployment portal. Under **Deployments**, create a deployment of `gpt-4.1` named `gpt-4.1`, using a deployment type and capacity available to the subscription.
3. Open the Azure resource's **Keys and Endpoint** and copy its endpoint. For a key-based local trial, copy a key into our ignored `.env`. If key access is disabled, use an approved service principal or managed identity instead.

For a local key-based trial, edit these entries in `.env`:

```dotenv
AGENT_REASONING_MODE=AzureOpenAI
AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT=gpt-4.1
AZURE_OPENAI_API_VERSION=2024-12-01-preview
AZURE_OPENAI_AUTHENTICATION=ApiKey
AZURE_OPENAI_API_KEY=<resource-key>
```

These settings select LangChain `AzureChatOpenAI` for the summary only. Restart the host after changing configuration, and use a new source event ID to call the model; a completed replay returns the cached result without another model request.

For `ClientSecret`, grant our service principal **Cognitive Services OpenAI User** on the resource through **Access control (IAM)**, then configure its tenant ID, client ID and client secret in the variables listed above. For `ManagedIdentity`, enable the identity on the Azure host and assign the same role. Leave `AZURE_OPENAI_MANAGED_IDENTITY_CLIENT_ID` blank for system-assigned identity, or set it to the client ID of an identity attached to that host. Clear `AZURE_OPENAI_API_KEY` when using either token-based mode because the underlying Azure OpenAI SDK rejects a simultaneous key and token provider.

The runtime uses `ManagedIdentityCredential` or `ClientSecretCredential` explicitly, with a bearer token provider for `https://cognitiveservices.azure.com/.default`. It never uses `DefaultAzureCredential` or an interactive development login. A model credential at this stage belongs to the host or service principal, not an Agent 365 blueprint.

The model receives the shipment, order and inventory facts. Host code still fixes the sequence as order read, inventory read, reasoning, notification, then ticket creation. Model output cannot choose additional tools or authorize shipment changes. Empty summaries and model errors fail the run before notification and ticket creation; we don't substitute a success message.

## API and retry behavior

An authenticated request looks like this:

```json
{
  "sourceEventId": "shipment-001",
  "orderId": "ORDER-1",
  "delayHours": 12
}
```

We send this object to `POST /api/shipments` with a bearer token and `Content-Type: application/json`. Event and order IDs accept 1 to 100 ASCII letters, digits, hyphens, underscores, periods or colons. `delayHours` must be an integer from 1 to 720. The body limit is 16 KiB, including chunked requests. Malformed JSON, nulls, arrays and incorrectly typed properties fail validation.

An optional `X-Correlation-ID` accepts 1 to 64 ASCII letters, digits, hyphens, underscores or periods. Multiple values are rejected. Every response carries a correlation header, generated when one wasn't supplied or was invalid.

A successful response has this shape:

```json
{
  "replayed": false,
  "result": {
    "runId": "<run-guid>",
    "correlationId": "<correlation-id>",
    "sourceEventId": "shipment-001",
    "reasoningMode": "Stub",
    "summary": "Local simulation: order ORDER-1 is delayed by 12 hours. Bergamo has 50 units of WIDGET-42; the order needs 20. Ask the operations team to assess an alternative shipment. No shipment has been changed.",
    "notificationId": "stub-notification-<run-guid>",
    "ticketId": "stub-ticket-<run-guid>"
  }
}
```

The order is for 20 units of `WIDGET-42` bound for Milan, and the stock reader reports 50 units in Bergamo. Notification and ticket IDs identify simulated writes only. On a completed replay, `replayed` is `true` and `result` is the original result, including its run and correlation IDs. The response header contains the current attempt's correlation ID, which may differ.

| HTTP status | Error or result |
| --- | --- |
| `200` | A new run, completed replay, or `/health` response |
| `400` | `invalid_correlation_id`, `invalid_request`, or `invalid_event` |
| `401` | `missing_token` or `invalid_token`, with `WWW-Authenticate: Bearer` |
| `403` | `app_only_required`, `wrong_tenant`, `caller_not_allowed`, `missing_role`, or `local_requires_loopback` |
| `409` | `payload_conflict`, `in_progress`, or `failed` |
| `413` | `invalid_request` when the body exceeds 16 KiB |
| `415` | `invalid_request` for an unsupported media type or encoding |
| `500` | `run_failed`; responses and application logs omit exception details |
| `503` | `capacity_reached` |

The bounded ledger uses the normalized caller client ID and source event ID as its key, and compares the order ID and delay on a duplicate. We reserve synchronously before any tool awaits. Completed events replay even when the ledger is full; active runs and failed runs return `409`. We retain failures because a notification may already have succeeded before a ticket fails.

> Restarting the process clears the ledger, including failed entries. Use durable replay storage and an operational recovery procedure before connecting real write tools or running multiple instances.

## Local behavior checks

```powershell
npm run build
npm test
```

The tests use Node's built-in `node:test` runner through `tsx`. They start loopback hosts with generated keys, validate local JWTs and mocked Entra signing keys, test configuration guards and malformed inputs, check concurrent reservations and retained failures, and send 400 events followed by 400 replays. Model tests inject credentials and responses without contacting Azure. The tests close only the hosts they created.

## Reading the logs

We write JSON records with an ISO UTC `Timestamp` and stable `EventName` fields: `ingress.rejected`, `shipment.invalid`, `ingress.replay`, `run.started`, `run.ended`, and `tool.ended`. Request context travels through asynchronous calls with `AsyncLocalStorage` and includes `CallerClientId`, `CallerDisplayName`, `IdentityMode`, `CorrelationId`, `SourceEventId`, and `RunId` when known.

Every rejection records a reason and a verified client ID or `unknown`. Run and tool completion records include outcome and duration even on failure. Tool records also carry `TargetSystem`, `Operation`, `DataScope`, `PermissionMode=none` and `ToolMode=Stub`, because no downstream application permission was exercised. We don't invent an agent identity object ID before registration.

## Wrapping up

We have the same machine-authenticated shipment workflow as the .NET sample. Choose the [skill-led](../../../3.Runbook.md) or [manual](../../../3.Runbook-Manual.md) runbook for registration and instrumentation. The manual route requires no coding assistant. On the skill-led route, we can ask:

> Register this agent with Agent 365. It runs without a signed-in user.

After registration, ask "Add Agent 365 observability to this agent" and choose **Agent (Non AI Teammate)** and **S2S** when prompted. The skill adds the packages, token service and instrumentation; the runbook's code examples explain those changes.
