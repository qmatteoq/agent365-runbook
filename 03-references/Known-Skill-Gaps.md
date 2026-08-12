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

---

## 2. `a365-code-validator` applies an S2S rule to OBO code

**Applies to:** any agent on an OBO path.

**What the skill does.** The validator checks that the principal on the observability token matches
the runtime agent identity, and flags a mismatch as a blocker:

```text
token azp/appid == route /agents/{agentId} == span gen_ai.agent.id
```

**Why that's a problem.** That rule is **S2S-specific**. On an OBO path the export route is keyed
by the calling app, and the service resolves it back to the registered agent. A "mismatch" there is
correct behaviour, not a bug.

**Symptom.** A `critical` or `high` finding telling you the identity binding is wrong, on an agent
whose telemetry is in fact arriving and attributed correctly.

**What to do.** On an OBO path, verify the *outcome* before acting on this finding. Does activity appear, attributed to the
right agent, in the admin center? If it does, the finding is a
false positive. Do not rewrite a working token chain to satisfy it.

---

## 3. LangChain is soft-warned, and it matters

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

**Applies to:** Python.

**What the skill does.** It wires `use_microsoft_opentelemetry(...)` into your entry point.

**Why that's a problem.** The distro can only patch libraries that haven't been imported yet. If
your entry point imports the agent module, and therefore LangChain, before calling the distro,
patching silently doesn't happen. Nothing errors.

**What to do.** Call the distro at the very top of your entry point, before any agent import, and
confirm `chat` spans appear.

---

## 5. Two enable flags, easy to set one

**Applies to:** all stacks.

`enable_a365` / `EnableA365` registers the span processors. `a365_enable_observability_exporter` /
`EnableAgent365Exporter` ships the spans. Setting only the first produces correctly-shaped spans
that never leave the process, with no error to tell you.

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

---

## Reporting

If you hit a gap that isn't listed here, it's worth raising at
https://github.com/microsoft/agent365-skills. The skills improve quickly, and several entries on
this page may be obsolete by the time you read them. Check the dates against the skill version you
have installed.
