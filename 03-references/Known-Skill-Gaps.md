# Known Skill Gaps

The [Agent 365 Skills](https://github.com/microsoft/agent365-skills) do most of the onboarding work
correctly, and the runbooks in this repo lean on them. But they are evolving alongside a preview
product, and there are places where following a skill's default path produces a working-looking
agent that is subtly wrong.

This page records those, so you can recognise them rather than debug them from scratch.

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

**What to do.** For Teams-hosted agents, follow
[Teams Agent: Custom Engine OBO](../01-scenarios/Teams-Agent-Custom-Engine-OBO/) rather than the
skill's default, and check the token chain the skill generated against it before running.

**Not affected.** The web-app user-OBO scenario. There, `obo` is the correct answer and the skill
does the right thing.

## 2. LangChain is soft-warned, and it matters

**Applies to:** Python + LangChain, Node.js + Semantic Kernel or Google ADK.

**What the skill does.** Phase 1 surfaces a soft warning that auto-instrumentation may not patch
your LLM library, then continues.

**Why that's a problem.** It's easy to read the warning as advisory and move on. It isn't. Without
auto-instrumentation you get an `invoke_agent` span and no `chat` spans. The agent looks
instrumented, and half its telemetry is missing.

**What to do.** On a soft-warned stack, plan to wrap every LLM call in `InferenceScope` manually,
and verify you see `chat` spans in Phase 4 rather than assuming them.

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

**What to do.** On Python, call the distro at the very top of your entry point, above any agent
import. On Node.js, put the call in its own module, `src/observability.ts`, and make importing that
module the first line of your entry point. Either way, confirm `chat` spans appear rather than
assuming them.

---

## 5. Two enable flags, easy to set one

**Applies to:** all stacks.

`enable_a365` / `EnableA365` / `a365.enabled` registers the span processors.
`a365_enable_observability_exporter` / `EnableAgent365Exporter` / `a365.enableObservabilityExporter`
ships the spans. Setting only the first produces correctly-shaped spans that never leave the
process, with no error to tell you.

**What to do.** Check both are set, in code rather than only in environment variables.

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
