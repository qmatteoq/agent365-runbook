# Known Skill Gaps

The [Agent 365 Skills](https://github.com/microsoft/agent365-skills) automate the skill-led
onboarding route. This page records behavior to check against the versions we use; each of the
four scenarios also has a [manual runbook](../01-scenarios/README.md) that needs no assistant.
The identity, exporter and initialization checks below also apply to manually written code.

For a runtime symptom such as missing activity, an authorization error or a host that won't start,
use the [troubleshooting guide](Troubleshooting.md). It covers both authoring routes and keeps
package-specific workarounds separate from general diagnostics.

> **How to read this.** Each entry says what the skill does, why it's a problem, and what to do
> instead. None of these are reasons to avoid the skills. They are reasons to check one specific
> thing before moving on.

---

## 1. `instrument-observability` has no custom-engine branch

**Applies to:** Teams / Microsoft 365 Copilot agents reached through their own bot registration.

**What the skill does.** Phase 0.5 offers exactly two auth modes for a non-AI-Teammate agent:
`obo` and `s2s`. It treats `obo` as the *agentic* on-behalf-of path, the one where the turn
arrives already carrying an agentic identity.

**Why that's a problem.** A Teams agent reached through its own bot app registration carries **no**
agentic identity on the turn. Microsoft's documented path for that shape is
**"custom engine using OBO"**, which is a different token chain from the agentic one. The skill
doesn't offer it, so answering "obo" routes you to the wrong chain, and answering "s2s" routes you
to a service-principal chain you don't want either.

**Symptom.** Export appears to work, but the identity on the exported spans is wrong, and activity
attribution in the Microsoft 365 admin center doesn't match what you expect.

**What to do.** Follow the custom engine
[skill-led](../01-scenarios/Teams-Agent-Custom-Engine-OBO/3.Runbook.md) or
[manual](../01-scenarios/Teams-Agent-Custom-Engine-OBO/3.Runbook-Manual.md) guide, and confirm
that the OAuth connection and telemetry name the bot app. This is different from the
[S2S scenario](../01-scenarios/Service-to-Service-Agent/1.Overview.md), where an app-only child
identity is the intended acting application.

**Not affected.** The web-app user-OBO scenario. There, `obo` is the correct answer and the skill
does the right thing.

## 2. LangChain is soft-warned, and it matters

**Applies to:** Python + LangChain, Node.js + Semantic Kernel or Google ADK.

**What the skill does.** Phase 1 surfaces a soft warning that auto-instrumentation may not patch
your LLM library, then continues.

**Why that's a problem.** It's easy to read the warning as advisory and move on. It isn't. Without
auto-instrumentation you get an `invoke_agent` span and no `chat` spans. The agent looks
instrumented, and half its telemetry is missing.

**What to do.** Check instrumentation for the actual framework and package versions. The manual
LangChain examples initialize the distro before model imports; other frameworks may require an
explicit `InferenceScope` around each real model call. Inspect the child spans during the chosen
runbook's verification phase, and don't add a second span when the framework already emits one.

---

## 4. Initialisation order isn't enforced

**Applies to:** Python and Node.js.

**What the skill does.** It wires `use_microsoft_opentelemetry(...)` or
`useMicrosoftOpenTelemetry(...)` into your entry point.

**Why that's a problem.** The distro can only patch libraries that haven't been imported yet. If
your entry point imports the agent module, and therefore LangChain, before calling the distro,
patching silently doesn't happen. Nothing errors.

On Node.js this is sharper than it looks, because you cannot fix it by moving the call up the file.
ES module imports are all evaluated before any of the importing module's own statements run, so a
`useMicrosoftOpenTelemetry()` call sitting at the top of `main.ts` still executes after every
`import` in that file has already loaded LangChain.

**What to do.** Load configuration first, then initialize the distro before importing the model
framework. For Node ESM, use the distro's loader and a bootstrap that loads observability before
the application. Moving a call above static imports is insufficient. The
[Teams manual](../01-scenarios/Teams-Agent-Custom-Engine-OBO/3.Runbook-Manual.md) and
[AI Teammate manual](../01-scenarios/AI-Teammate-Agent-Identity/3.Runbook-Manual.md) show that
startup order. Confirm actual inference and tool spans, and retain a single initialization.

---

## 5. Two enable flags, easy to set one

**Applies to:** Python and Node.js distro configurations with separate Agent 365 switches.

`enable_a365` / `a365.enabled` enables Agent 365 processing.
`a365_enable_observability_exporter` / `a365.enableObservabilityExporter` enables export.
For an Agent 365 destination, both must be configured. The .NET 1.0.7 examples instead select
`ExportTarget.Agent365` through the distro's exporter configuration.

**What to do.** Follow the switches for the package version in our runbook. The S2S manual also
offers Console and OTLP destinations that do not contact Agent 365; local spans from those
destinations are not proof of tenant ingestion.

---

## 6. The exporter token cache isn't registered for you

**Applies to:** .NET AI Teammates.

**What the skill's reference says.** That `UseMicrosoftOpenTelemetry` registers
`IExporterTokenCache<AgenticTokenStruct>` as part of its own wiring.

**What actually happens.** It does not. We verified this against `Microsoft.OpenTelemetry` 1.0.7. You must
register it yourself:

```csharp
var agenticTokenCache = new AgenticTokenCache();
builder.Services.AddSingleton<IExporterTokenCache<AgenticTokenStruct>>(agenticTokenCache);
```

**Symptom.** The host fails to start with a dependency-injection error.

**Why it's low-risk.** This one fails loudly and immediately, so it costs you minutes rather than
days. It's recorded because the *documentation* points the wrong way, which makes the error
confusing rather than obvious.

**Check before working around it.** This may be fixed in the version you have.

---

## 7. `FromTurnContext` overwrites the agent id

**Applies to:** .NET agents using `BaggageBuilder.FromTurnContext`.

**What it does.** Supplies `user.id`, `user.name`, `microsoft.channel.name` and the conversation id
from the activity, which is genuinely convenient.

**Why that's a problem.** It **also** writes `gen_ai.agent.id`, from `Recipient.AgenticAppId`. If
your agent resolves its id some other way, as an AI Teammate does, from the agentic instance id,
then whichever call comes last wins, because `BaggageBuilder` keeps a single dictionary.

**Symptom.** The agent id is right in ordinary chat turns and wrong on email-triggered ones. Easy to
miss, because the common path looks correct.

**What to do.** Chain your explicit `.AgentId()` **after** `.FromTurnContext()`, and verify on a
non-chat turn rather than only in Teams chat.

## 8. S2S must not inherit a human token or caller identity

**Applies to:** webhooks, schedulers and other app-only workloads.

The caller's incoming API token authorizes the request, not the agent's downstream work. The
agent needs its own application permissions and blueprint-to-child token exchange. A developer
token or user OBO fallback would change the identity under which the operation runs.

**What to do.** Follow the [S2S skill-led](../01-scenarios/Service-to-Service-Agent/3.Runbook.md)
or [manual](../01-scenarios/Service-to-Service-Agent/3.Runbook-Manual.md) path. Use the child
application ID and S2S export endpoint, retain verified service-caller attributes without inventing
a human, and check that rejected requests and completed replays create no new agent invocation.
Stub reasoning must not emit a `chat` span.

## Wrapping up

Use these checks alongside the chosen runbook, whether changes come from a skill or our editor.
Resolve missing identity, token acquisition and span-shape problems before treating successful
export as completed onboarding.
