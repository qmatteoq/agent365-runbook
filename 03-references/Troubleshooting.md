# Troubleshooting Agent 365 onboarding

Our agent can answer questions or process webhooks normally while none of its activity reaches Agent 365. We need to check the model connection, incoming request authentication and observability exporter separately to find where the operation stops.

This guide applies to our own agents and to the optional samples, whether we followed a skill-led or manual runbook. We use the [scenario index](../01-scenarios/README.md) to choose the identity path; switching authentication modes is not a general troubleshooting step.

## Start with one operation

Before changing registration or instrumentation, we'll follow one request through the running application:

1. Confirm which process, project copy and environment are running. Check its launch command, working directory, configuration sources and package versions. An edit to a different checkout or an environment file that the host never loads will have no effect.
2. Restart through the application's normal launch path after changing startup configuration. Preserve the existing authentication and secret providers.
3. Send one synthetic request and record its UTC time, conversation or correlation ID, and expected model and tool calls. For S2S, use a new source event ID; a completed replay should not execute the agent again.
4. Follow that operation through application execution, local semantic spans, exporter token resolution, the export HTTP result and the destination view. Stop at the first missing piece.

If a dashboard or task runner launches the agent, change the configuration that launcher supplies and restart that specific process there. Setting an environment variable in an unrelated terminal does not update the running agent.

> Keep authorization headers, access tokens, client secrets and real user content out of shared diagnostics. Use a test request approved for telemetry capture, and restore normal logging after the reproduction. Don't run `a365 cleanup` or delete an instance to investigate a missing trace.

## Find the symptom

| What we see | Start here |
| --- | --- |
| The application works, but no export request is visible | [Exporter activation and logging](#the-application-works-but-no-export-is-visible) |
| `Partitioned into 0 identity groups`, or unexpected groups | [Baggage and identity boundaries](#spans-are-skipped-or-split-into-identity-groups) |
| Export returns HTTP `200`, but Activity is empty | [Export acceptance versus reporting](#export-returns-200-but-activity-is-empty) |
| Only invocation spans, only inference spans, or duplicate spans | [The invocation tree](#the-span-tree-is-incomplete-or-duplicated) |
| Activity shows the wrong agent or caller | [Identity attribution](#activity-is-attributed-to-the-wrong-identity) |
| Export returns `401`, `403`, or a consent error | [Token, audience and grants](#token-acquisition-or-export-is-unauthorized) |
| Telemetry stops after working for a while | [Token lifetime and shutdown](#telemetry-stops-after-working) |
| Sign-in or the first prompt fails after a restart or configuration change | [Local authentication state](#local-sign-in-fails-after-a-restart-or-configuration-change) |
| Teams stops answering after registration | [Channel credentials and OAuth](#teams-stops-answering-after-registration) |
| An AI Teammate is published but unavailable, or its handler never runs | [Provisioning and agentic turns](#an-ai-teammate-is-published-but-does-not-answer) |
| The host fails to start after SDK changes | [Package and API compatibility](#the-host-fails-after-sdk-or-configuration-changes) |
| Push protection rejects a configuration file after setup | [Secrets written by setup](#setup-wrote-credentials-into-tracked-configuration) |
| A Work IQ manifest exists but no tool works | [Tool discovery and execution](#work-iq-is-configured-but-tools-do-not-work) |
| An S2S webhook works but has no inference or tenant telemetry | [S2S execution boundaries](#an-s2s-webhook-works-but-the-expected-trace-is-missing) |

## The application works, but no export is visible

### Check the selected destination

A startup message can report that observability is configured while the Agent 365 exporter remains disabled. Console output and successful exports to Azure Monitor or an OTLP collector help us inspect the pipeline, but don't establish whether it sends anything to Agent 365.

For the distro versions used by the manual runbooks, inspect the effective startup configuration:

| Stack | What we check |
| --- | --- |
| .NET | The configured `ExportTarget` includes `Agent365`, and the token resolver uses the intended cache. An application setting such as `EnableAgent365Exporter` only works if startup code reads it |
| Python | `enable_a365=True` enables Agent 365 processing, while `a365_enable_observability_exporter=True` enables export. The custom resolver must return a token string synchronously |
| Node.js | `a365.enabled` and `a365.enableObservabilityExporter` are enabled, with the appropriate resolver and endpoint choice |

Keep a single telemetry initialization. If the application already has an OpenTelemetry provider, extend its configuration instead of creating a second provider. For Python distro calls, also check option spelling: accepting `**kwargs` does not guarantee that a misspelled option has any effect.

The S2S manual has explicit Console, OTLP and Agent365 destinations. Console or OTLP mode does not start its Agent 365 token service. Use the configuration names in our chosen runbook or application, not an environment variable copied from another sample.

### Make the export result visible

Some exporter versions log successful requests only at Debug, so Info logs can leave us without a record of whether a POST occurred. An environment variable changes logging only if the SDK or application reads it.

For an ASP.NET Core host using the Agent 365 logging category, set this in the terminal that will start the process:

```powershell
Set-Item -Path 'Env:Logging__LogLevel__Microsoft.Agents.A365.Observability' -Value 'Debug'
```

This changes the category's log level for child processes launched from that terminal. Restart the host through its usual command and ensure the logging provider accepts Debug records. It does not enable export, change credentials or affect an already running process.

For Python applications using `microsoft-opentelemetry`, configure the distro logger after the application's logging setup and before telemetry initialization:

```python
import logging

logging.getLogger("microsoft.opentelemetry").setLevel(logging.DEBUG)
```

This targets the distro's logger without turning on Debug for every library. The logging handler must also accept that level. With Python distro 1.3.6, configure this logger explicitly unless our application already maps `A365_OBSERVABILITY_LOG_LEVEL` to it. Don't assume that Node's logging environment variable configures Python automatically. Older standalone Agent 365 SDK packages use different logger names.

For Node, follow the installed distro's `A365_OBSERVABILITY_LOG_LEVEL` support and the [distro troubleshooting reference](https://learn.microsoft.com/microsoft-agent-365/developer/microsoft-opentelemetry#troubleshooting). Inspect the actual request result using the diagnostics that version exposes.

Record token resolution and the export attempt, along with the sanitized response status and error body. Messages such as "spans queued" or "exporter enabled" stop short of describing the request's result.

## Spans are skipped or split into identity groups

Agent 365 partitions spans by tenant and agent identity before export. `Partitioned into 0 identity groups` usually means no eligible spans carried those values when the exporter processed them.

Open the baggage scope around the whole instrumented operation, including awaited model and tool work. The root span's fields alone don't supply its children's execution context, so inspect the child spans too, especially across asynchronous callbacks or thread boundaries.

For one isolated turn, compare the agent and tenant IDs in baggage, `AgentDetails`, the token-cache key and the export route. Two groups can indicate that different parts of that turn used different IDs. A production batch can legitimately contain multiple agents or tenants, so the group count alone is not an error; don't combine their identities to make the count smaller.

On Node, keep the promise returned by the asynchronous callback passed to the baggage scope and await it. Starting work inside a callback without returning its promise can end the enclosing operation before that work completes.

On .NET, a helper such as `FromTurnContext` can assign an agent ID as well as channel and caller fields. Apply the validated runtime agent ID after that helper when it would otherwise supply the wrong value. The [AI Teammate architecture](../01-scenarios/AI-Teammate-Agent-Identity/2.Architecture.md#scenario-d-baggage-ordering) explains that ordering.

## Export returns 200, but Activity is empty

An HTTP success response doesn't tell us whether the expected activity is available in a downstream product. Keep the response body, since it can contain rejection or partial-success details, and check the same operation at each stage:

1. Confirm that the request reached the intended tenant and Agent 365 destination, then inspect any returned rejection details.
2. Find the same operation's semantic spans locally. It needs an `invoke_agent` record with the expected identity and conversation context, not just HTTP or model instrumentation.
3. Check the invocation input and recorded output using the APIs for our SDK version. Enable content capture only for approved data; do not enable it across production traffic to investigate a test turn.
4. Confirm the acting application and caller attribution for the selected scenario, using the [identity table below](#activity-is-attributed-to-the-wrong-identity).
5. Have the administrator confirm Agent 365 eligibility and assigned licenses in the intended tenant, along with the destination's prerequisites and the reader's permissions. A license SKU being available in the tenant is not the same as an assigned license.
6. Check the time range and allow for processing delay, then look for the same operation in Defender and the admin center. Use the verification phase of our runbook for the operation-specific query fields.

If Defender contains inference or tool records but Activity is empty, start with the invocation and its attribution. If nothing appears anywhere, we still need to investigate exporter configuration, authentication and tenant eligibility; the empty views don't isolate one cause.

Leave IDs and registrations unchanged while waiting for reporting. If the local trace, export result and tenant prerequisites look correct, preserve the reproduction for support.

## The span tree is incomplete or duplicated

### Inference or tool records exist without an invocation

Framework instrumentation can record model calls without opening the Agent 365 invocation scope. Wrap the operation with one `InvokeAgentScope`, record its input and output, and keep model and tool work inside it.

Use the root and context handling in our scenario's manual implementation. If an unrelated HTTP server span becomes the invocation's parent or identity attributes disappear from children, review activity-source subscriptions, processor ordering and context propagation. Don't disable all application tracing to hide the parent.

### The invocation has no model or tool children

Check whether this operation called the model and tools at all. A greeting, cached response or stub result may not involve either.

For a real model request:

- Initialize the Python distro before importing LangChain or the model library. Match the enabled framework integrations to the libraries the application uses; adding unrelated integrations can change enrichment behavior.
- For Node ESM, retain the distro loader and bootstrap order from the manual guide. Moving a function call above static imports is insufficient because imported modules are evaluated before the module body. Starting the application through a different command can bypass the loader.
- On .NET, check the model-client instrumentation and subscribed activity sources. The worked Agent Framework examples use `UseFunctionInvocation()` before `UseOpenTelemetry()`; don't add that chain again if the existing client already has it.

If the framework does not produce the required semantic spans, instrument its real model and tool boundaries explicitly. Keep the span content tied to the actual request and response.

### A .NET model span exists locally but loses identity before export

With `Microsoft.OpenTelemetry` 1.0.7 and the `Microsoft.Extensions.AI` 10.8.3 integration, a `chat` span can start before the chat client sets `gen_ai.operation.name`. The distro's start-time enrichment then misses the operation, so the model answers and the console shows a span, but Agent 365 skips it for missing tenant or agent identity.

Compare the child span's identity with the invocation, then inspect processor registration order. The [Teams manual's backfill processor](../01-scenarios/Teams-Agent-Custom-Engine-OBO/3.Runbook-Manual.md#add-the-exporter-cache-and-turn-wrapper) fills missing identity tags at `OnEnd`, before the distro's export processor reads the span. Register it before `UseMicrosoftOpenTelemetry`, retain the trusted turn baggage until child spans end, and keep the copy limited to identity fields. Don't overwrite existing tags or copy the turn's messages over a model span's own input and output.

After upgrading those packages, check whether the SDK now enriches the spans before retaining this custom processor. Adding another inference span would duplicate the model operation without repairing the original span's identity.

### Spans or tool nodes appear twice

Compare trace and span IDs, invocation scopes and actual tool execution before changing the application. Two views or operation records can describe the same tool call.

If there really are duplicate spans, look for two provider initializations, duplicate invocation wrappers, or manual instrumentation around a call already instrumented by the framework. Python startup can import the entry module again under a different name; messages such as `Attempting to instrument while already instrumented` warrant a check of that launch path.

If a write happened twice, inspect tool registration and the application's execution or retry logic. The [Work IQ checks](#work-iq-is-configured-but-tools-do-not-work) distinguish repeated execution from multiple representations in the activity map.

## Activity is attributed to the wrong identity

The trace and export route must use the application ID represented by the export token. Which application that is depends on the scenario:

| Scenario | Acting application ID on the trace and export route | Caller or user context |
| --- | --- | --- |
| Web app, user OBO | Child agent identity's application client ID | Authenticated human user's directory object ID |
| Teams, custom engine OBO | Bot app registration's client ID | Authenticated Teams sender's `aadObjectId` |
| AI Teammate / Autopilot | Provisioned runtime instance application ID | Agentic-user context; the human initiator is a separate attribution field |
| S2S | Child agent identity's application client ID | Verified service caller; no signed-in human is required |

The blueprint ID is governance metadata. A service principal object ID is useful for permission assignments but does not replace the application client ID in the export route. For AI Teammate, the agent user's directory object ID is also distinct from the runtime application ID.

For human attribution, don't substitute a channel-local sender ID, an application-specific `sub`, a display name or an invented email for the directory object ID. In a .NET web app, claim mapping can mean `FindFirst("oid")` returns nothing even though sign-in succeeded; use the Microsoft Identity Web `GetObjectId()` helper used in the runbook.

For S2S, preserve the verified calling application and business-event correlation. A sponsor is governance metadata, not evidence that the sponsor signed in or authorized the webhook. Don't repair an empty human field by inventing a `UserDetails` identity.

The [token-chain reference](../02-patterns/The-Three-Token-Chains.md) explains why these IDs differ.

## Token acquisition or export is unauthorized

Find the endpoint that returned the error before changing permissions. A `401` from the webhook, model provider, OAuth connection, Work IQ server and observability exporter describes a different boundary in each case.

For the export token, inspect claims locally using approved tooling without sharing the token itself. Decoding a JWT does not validate it; authentication still belongs to the SDK and the resource that accepts it. Compare the trusted identity context with `tid`, `aud`, expiry, the acting application (`azp` or `appid`), and the relevant permission claim.

| Check | Delegated routes: web OBO, Teams OBO, agentic user | S2S agent route |
| --- | --- | --- |
| Observability scope requested by these runbooks | `api://9b975845-388f-4429-889e-eab1ef63949c/Agent365.Observability.OtelWrite` | `api://9b975845-388f-4429-889e-eab1ef63949c/.default` |
| Permission in the resulting token | Delegated `Agent365.Observability.OtelWrite` scope | `Agent365.Observability.OtelWrite` application role |
| Export route family | `/observability/` | `/observabilityService/` |
| Identity agreement | Token's acting application matches the scenario's export ID | Token's acting application is the child client ID, not the blueprint or inbound caller |

The resource GUID is the Observability API's fixed application ID; leave it unchanged when substituting our tenant and agent values.

For `401 InvalidAudience`, inspect the final token's audience and how it was obtained. The web sign-in assertion must target the blueprint before its OBO exchange; it is not itself the final export token. The custom engine OAuth connection must request the named observability scope, not a Bot Framework or Graph scope. Use the full flow from the chosen runbook rather than changing a scope string in isolation.

For `403`, check identity agreement, actual consent or role assignment, tenant eligibility and recent permission propagation. Declaring a permission in a manifest or seeing it listed on a blueprint does not prove that the acting principal has the effective grant. Don't grant both delegated and application permissions indiscriminately to get past an error.

`AADSTS82001` needs the same boundary check. In the web OBO and agentic S2S exchanges, inspect the blueprint-to-child flow and `fmi_path`. On a custom engine Bot Framework reply, check that the connection still uses the ordinary bot app. The error does not mean every blueprint-derived client-credentials flow is unsupported.

For `429`, timeouts or `5xx`, preserve the response and request identifier, and inspect network behavior and the installed SDK's retry policy. Don't turn an authorization failure into an unlimited retry loop, disable TLS validation, or send credentials to an alternative endpoint.

## Telemetry stops after working

If new operations execute but stop exporting near the token's expiry, check refresh and cache ownership. A token acquired at startup still expires and needs to be replaced.

The resolver must use the same agent and tenant keys as the spans. Refresh before expiry, and make token acquisition failures visible through the application's error handling. For delegated flows, keep credentials bound to the appropriate user or instance; don't replace a failed token with an operator's Azure CLI credential.

Python's exporter resolver is synchronous. Acquire tokens asynchronously on the appropriate application path, then expose the cached token string through a thread-safe synchronous resolver. The resolver must return the string itself, not a coroutine or the SDK response object that contains it.

If only the last operation disappears, inspect graceful shutdown and exporter flushing. A forced termination can lose a buffered batch. Don't enlarge queues or delay every response before establishing whether the host exits normally.

## Local sign-in fails after a restart or configuration change

### The browser looks signed in, but the first prompt fails

A persistent authentication cookie can outlive an in-memory MSAL token cache. In a .NET web app, `MsalUiRequiredException` or `IDW10502` after restarting the host can mean the cookie is valid but the application can no longer obtain the token needed for that user.

For the local reproduction, sign out through the application, sign back in and repeat the prompt. In our application, handle interaction-required errors through the normal sign-in or consent flow, with protection against redirect loops. Don't catch every token error and continue anonymously. The [web runbooks](../01-scenarios/Web-App-Agent-User-OBO/1.Overview.md) describe sign-in and token acquisition separately.

### The sign-in callback loses the session

Use the same browser hostname as the configured callback and cookie host. `localhost` and `127.0.0.1` can reach the same process but do not share host-scoped cookies. Check the scheme and port as well; use our application's configured values, not a port copied from another sample.

### A pull or SDK update changes the required configuration

Pulling source leaves ignored `.env` files and local secret stores unchanged. Compare configuration key names with the tracked example, including settings that the Agents SDK reads outside our application's settings class. A missing authorization handler may only surface on the first authenticated turn, after the host has started successfully.

Merge the required keys through our existing configuration provider instead of replacing the whole file. Restart the process that actually loads those settings, and keep any backups containing secrets protected and outside version control.

If a local .NET run starts contacting `169.254.169.254`, inspect its model credential selection. Running as Production does not give a workstation a managed identity, and it can also stop the default loading of user-secrets. Select the approved credential for the actual host; Production mode is not a prerequisite for Agent 365 export.

## Teams stops answering after registration

For an `Invalid Bot` error during installation, compare the manifest's bot ID with the ordinary bot app and its Azure Bot registration. A blueprint alone does not provide the custom engine channel registration. Follow the [Teams manual's bot setup](../01-scenarios/Teams-Agent-Custom-Engine-OBO/3.Runbook-Manual.md#step-0-2-confirm-or-create-the-bot-registration); requesting an AI Teammate instance is a different onboarding path.

The custom engine path keeps its Azure Bot identity after Agent 365 registration. If it stops replying after setup or only after the next restart, compare the effective channel connection and inbound audience with the bot settings saved before setup.

`a365 setup all` can replace local connection values with blueprint credentials. Restore the bot's client ID, tenant, secret source and audience for this path. Replacing a value in local configuration does not revoke the original Entra secret; do not rotate or delete unrelated credentials as a first step.

If the bot still receives messages but observability sign-in fails:

1. In the bot app registration, open **Authentication** and check the **Web** redirect URI `https://token.botframework.com/.auth/web/redirect`. This is the Bot Service OAuth callback, not our tunnel's messaging URL.
2. In the Azure Bot resource, open **Configuration**, select the intended **OAuth connection**, and check that its client ID is the bot app and its requested scope is the named observability scope.
3. Match the application authorization handler to that connection, and ensure the instrumented route actually invokes sign-in before token acquisition.
4. Confirm that the resulting token, cache key and trace all name the bot app.

On Python, handler names can be normalized to uppercase by the configuration loader. The manual examples use `OBOCONNECTIONPROFILE`, with `TYPE=UserAuthorization` as a sibling of `SETTINGS`. Match the schema and casing for the installed Agents SDK, not just the connection's display name.

Preserve OAuth connections that serve other resources. If Work IQ uses a bot-audience token as an assertion, changing that connection to request the observability audience can break its exchange. Keep the existing connection and add the separate observability connection shown in the manual.

If sign-in starts during app installation or a welcome activity, inspect global automatic sign-in settings. Require the handler on the message routes that need it, while retaining the intended behavior of installation, reset and sign-out routes.

The [Teams manual](../01-scenarios/Teams-Agent-Custom-Engine-OBO/3.Runbook-Manual.md) supplies the portal and source-edit steps. Preserve JWT validation on the messaging route while diagnosing sign-in.

## An AI Teammate is published but does not answer

An AI Teammate needs publication, activation, an instance request, administrator approval and provisioning. We can have a visible blueprint or a successful publish command while the runtime instance is still missing.

Follow the [manual provisioning sequence](../01-scenarios/AI-Teammate-Agent-Identity/3.Runbook-Manual.md#step-1-5-publish-activate-and-approve-an-instance). Check the pilot audience and requested instance in **Microsoft 365 admin center** > **Agents** > **All agents**. An administrator must approve a pending request; republishing does not approve it.

For an approved instance, check the registered notification endpoint, its current host and route, and the channel authentication before investigating telemetry. A changed local tunnel needs an endpoint update, not a new agent identity.

If package upload fails, read the validation error against the manifest inside the ZIP we uploaded. For example, `exceeds maximum length of 80. Path 'description.short'` identifies the short-description field. Correct that field and rebuild the package; editing the source manifest without rebuilding leaves the rejected value in the ZIP.

If the user sees a typing indicator followed by no answer, inspect authorization errors before the message callback. An agentic-user handler requesting Graph scopes without the corresponding consent can fail before our model code runs. The observability handler in these manuals requests the observability scope; Work IQ resources need their own grants and token requests.

Agentic channels can also reject typing activities. Suppress typing on the affected agentic route as shown by the manual implementation, while preserving it on channels that support it.

For Python Agents SDK 1.2.0, the worked implementation uses handler `AGENTIC`, with `TYPE=AgenticUserAuthorization` under the handler rather than inside `SETTINGS`. For .NET, check the [cache registration](#the-host-fails-after-sdk-or-configuration-changes).

A legitimate non-agentic local message can exercise the plain response path, but it cannot prove tenant attribution for an approved instance. A malformed agentic identity or failed agentic token request must not silently select a human OBO or app-only fallback.

## The host fails after SDK or configuration changes

### Match the package family and version

| Failure | What we check |
| --- | --- |
| .NET `CS0433`, duplicate observability types | `Microsoft.OpenTelemetry` already bundles Agent 365 components. Check for direct references to overlapping legacy Runtime or Hosting packages |
| .NET cannot resolve `IExporterTokenCache<AgenticTokenStruct>` | With the 1.0.7 manual implementation, register the cache explicitly and share that instance between the agent and exporter |
| A copied `.Agent365.Exporter` member does not compile | The 1.0.7 worked examples configure `.Agent365.TokenResolver` and `.Agent365.UseS2SEndpoint` directly |
| Python scope construction fails with a hostname or endpoint attribute error | Use the installed SDK's endpoint object and constructor arguments; a URL string, hostname and endpoint object are not interchangeable |
| Python attempts a native build on Windows ARM | Check interpreter architecture and available wheels through the approved package source. The Python sample READMEs describe the x64 interpreter option |
| Local .NET configuration disappears when running as Production | `UserSecrets` is normally a Development provider. Use the manual guide's explicit local-only setup where needed; retain the real production secret provider |

The [current Learn distro page](https://learn.microsoft.com/microsoft-agent-365/developer/microsoft-opentelemetry) describes automatic .NET cache registration and examples with a nested exporter property. The pinned `Microsoft.OpenTelemetry` 1.0.7 implementations in this repo require the explicit registration and flat configuration above. Use the API of the installed package; do not mix pieces of those examples.

The [AI Teammate manual](../01-scenarios/AI-Teammate-Agent-Identity/3.Runbook-Manual.md#optional-educational-implementations) lists its worked SDK versions. Those pins describe the examples, not a requirement to downgrade an existing application.

> Keep restores on the organization's configured package sources and proxies. A missing package, native wheel or TLS trust failure needs an approved package or environment resolution, not a public-feed override or disabled certificate checks.

### Setup wrote credentials into tracked configuration

Review configuration changes before committing them. Setup commands can write credentials to files, and a redacted terminal display does not prove that the underlying file is safe to commit.

If push protection identifies a credential, follow the repository's approved secret-handling process for the flagged file and commit. Move runtime secrets to the application's protected configuration provider, then remove them from material intended for publication. Rotate or revoke exposed credentials as required by the incident process; removing a value from the current file does not remove it from Git history or invalidate it. Don't bypass push protection because the terminal output looked masked.

## Work IQ is configured, but tools do not work

Separate server selection, permission grants, runtime discovery and actual tool execution. `ToolingManifest.json` records selected servers; it does not by itself connect their tools to the model.

The manual runbooks cover selection and consent, then identify the runtime integration we still need to implement. Missing Mail or Calendar tools at that point tell us to check the tooling path, not assume that observability failed.

For an implemented runtime integration:

1. Confirm that each selected server appears once in the manifest and is registered once in the application.
2. Check the tool resource's token audience, permissions and user or instance ownership. An observability token is not a Work IQ token.
3. Separate an MCP discovery or connection failure from an error returned by an executed tool.
4. For a write, confirm the actual side effect and execution record. A server node and tool node in a map do not prove two writes.

For `AADSTS65001 consent_required`, identify the resource and scope in the failing token request. Graph consent does not establish consent for each Work IQ resource. Compare the server's published requirements, such as `Tools.ListInvoke.All` where applicable, with the effective grants for our chosen identity flow. Gateway discovery and individual servers can require different permissions. Have the administrator grant the missing permission for that resource rather than widening unrelated grants.

An AI Teammate can export telemetry correctly while tool token acquisition fails. For the delegated Work IQ integration, use the configured agentic-user handler and the tool's resource scope. Replacing that exchange with direct blueprint client credentials can produce `AADSTS82001`; changing URI spelling or adding `/.default` does not supply the missing delegated context.

With Tooling SDK 1.0.0 and MCP 1.3.0, a .NET `TypeLoadException` naming `ModelContextProtocol.Client.IMcpClient` identifies an API mismatch: the Tooling SDK expects an interface that MCP 1.3.0 no longer exposes. Compare the resolved Tooling SDK, MCP and model-library versions and use a compatible supported set. The symptom occurs during local registration, before a remote tool operation; adding consent cannot repair that assembly mismatch.

For a service-side `500`, record the sanitized endpoint, timestamp and request identifier. Check whether gateway discovery failed or the error came from an individual server. If our integration supports explicit connections to the servers in `ToolingManifest.json`, that can provide an alternative to discovery, but we still need per-server authentication, lifecycle management and tool registration. Check current SDK support before adopting it, and report any servers that failed to load instead of presenting a reduced tool list as complete.

Neither a discovery failure nor a model response saying "I can't send mail" proves that Work IQ is unavailable for the scenario. Inspect the actual discovery, token and tool-execution errors.

For S2S, use downstream APIs that support the application's required app-only operations. The delegated Work IQ route described by the conversational runbooks is not a substitute.

## An S2S webhook works, but the expected trace is missing

The webhook caller, model credential and Agent 365 exporter credential have separate purposes. A valid incoming token and a successful model response prove neither S2S token acquisition nor tenant ingestion.

| Observation | Interpretation and next check |
| --- | --- |
| The same event returns its previous result | Expected replay behavior. Use a new event ID to inspect another invocation; don't move the invocation scope ahead of duplicate detection |
| A stub response has no `chat` span | Expected: no model was called. Enable real reasoning through the supported configuration before expecting inference telemetry |
| Console spans appear, but no Agent 365 token request occurs | Check the selected export target. Console-only mode can omit the token service |
| The model works with a local developer sign-in | Check the exporter's blueprint-derived credential and permissions separately |
| Export has `scp` and a human user context | This is a delegated token, not the intended S2S application's final token |
| A notification or ticket ID starts with `stub-` | The tool is simulated; no external message or ticket is implied |
| A process restart permits the event to run again | The sample ledger is process-local. Durable state and downstream idempotency are required for deployment |

If our existing agent uses developer credentials for local model access, keep that choice separate from exporter authentication. The starting points here use explicit noninteractive model credentials, as described in the [S2S configuration](../01-scenarios/Service-to-Service-Agent/1.Overview.md). Don't copy a model client's credential into the observability token resolver.

Keep the S2S token chain on the registered blueprint and child identity, with the child's application-role assignment. A sponsor or incoming service caller must not replace the child application ID on exported spans.

Use one new event when checking live inference. A large replay harness can make paid model calls for every new event when real reasoning is enabled; use stub mode for the local bulk exercise.

## Collect a useful escalation record

Once we've isolated the failing layer, retain:

- The scenario, stack, resolved package versions and effective export destination.
- The UTC reproduction time, operation name, conversation or correlation ID, and sanitized status and error details.
- Whether local invocation, inference and tool spans exist, and whether they share the expected parent and identity.
- Whether token resolution and an export POST occurred, separately from what appeared in each destination.
- The relevant administrator's confirmation of the required grants and tenant eligibility.

Include tenant and application identifiers only through an approved support channel when needed. Don't attach raw tokens, complete environment files, user-secret stores, or unredacted prompts and tool results.

## References

| Reference | Use |
| --- | --- |
| [Scenario runbooks](../01-scenarios/README.md) | Full manual and skill-led implementations for all four paths |
| [Token chains](../02-patterns/The-Three-Token-Chains.md) | Acting identities, resource tokens and export endpoints |
| [Known skill gaps](Known-Skill-Gaps.md) | Checks specific to generated instrumentation and package behavior |
| [Microsoft OpenTelemetry Distro](https://learn.microsoft.com/microsoft-agent-365/developer/microsoft-opentelemetry) | Current distro setup and logging guidance |
| [Observability authentication](https://learn.microsoft.com/microsoft-agent-365/developer/observability-authentication-setup) | Scenario-specific authentication recipes |
| [Observability troubleshooting](https://learn.microsoft.com/microsoft-agent-365/developer/observability#troubleshooting) | Export errors and downstream prerequisites |
| [Observability attribute reference](https://learn.microsoft.com/microsoft-agent-365/developer/observability-attribute-reference) | Operation-specific attributes used in reporting |

## Wrapping up

After applying a fix for the failing layer and SDK version, repeat the controlled request, using a new operation identifier where required. Follow that operation through export and reporting; if it still fails, keep the sanitized evidence from the failing step with the package versions used to reproduce it.
