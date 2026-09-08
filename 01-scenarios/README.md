# Scenarios

Each scenario is a complete onboarding, start to finish: an un-instrumented agent, and the runbook
that turns it into an Agent 365 agent.

## Available scenarios

| Scenario | Onboarding path | Stacks | Hosting | Status |
| --- | --- | --- | --- | --- |
| [Web App Agent: User OBO](Web-App-Agent-User-OBO/) | User on-behalf-of | .NET Agent Framework, Python + LangChain, Node.js + LangChain | Web app (Blazor / FastAPI / Express) | ✅ Runbook written |
| [Teams Agent: Custom Engine OBO](Teams-Agent-Custom-Engine-OBO/) | Custom engine agent OBO | .NET Agent Framework, Python + LangChain, Node.js + LangChain | Teams / M365 Copilot | ✅ Runbook written |
| [AI Teammate: Agent Identity](AI-Teammate-Agent-Identity/) | Agent's own identity | .NET Agent Framework, Python + LangChain, Node.js + LangChain | Teams / M365 Copilot | ✅ Runbook written |
| [Service-to-service agent](Service-to-Service-Agent/1.Overview.md) | App-only S2S | .NET Agent Framework, Python + LangChain, Node.js + LangChain | Webhook (ASP.NET Core / FastAPI / Express) | Starting points, [skill-led](Service-to-Service-Agent/3.Runbook.md) and [manual](Service-to-Service-Agent/3.Runbook-Manual.md) runbooks |

The scenarios are organised by **onboarding path**, not by stack, because the path is what
changes the work. Within a scenario, the stacks appear as parallel variants of the same steps.

## The agents we're onboarding

The web app, Teams and AI teammate scenarios use the same **Microsoft ecosystem research assistant**: it answers
questions about Microsoft products by searching the
[Microsoft Learn MCP server](https://learn.microsoft.com/api/mcp) and grounding its answers in what
it retrieves.

That keeps the agent logic consistent while we compare those onboarding paths. The S2S scenario uses a
supply-chain exception workflow instead, so we can follow a machine-triggered business event through
authorization, tool calls and retries without inventing a signed-in user.

## Scenario structure

Every scenario folder follows the same layout:

| File / folder | Contents |
| --- | --- |
| `0.Resources/` | `Images/` for screenshots and diagrams, `Starting-point/` for the un-instrumented agent |
| `1.Overview.md` | What the scenario is, who it's for, in scope / out of scope |
| `2.Architecture.md` | How the pieces fit together, and the token flow |
| `3.Runbook.md` | The phased, step-by-step onboarding guide |
| `3.Runbook-Manual.md` | Manual commands and code changes, where a companion guide is available |
| `4.Sample-prompts.md` | Prompts to exercise the finished agent |

## Runbook phases

The web app, Teams and AI teammate runbooks use these phases, and **each is a valid stopping point**:

| Phase | What you get | Skill |
| --- | --- | --- |
| **Phase 0**: Prerequisites | A working starting point and the tooling installed | N/A |
| **Phase 1**: Registration | The agent exists as an identity in your tenant | `a365-setup`, `make-a365-agent` / `make-ai-teammate` |
| **Phase 2**: Observability | Agent activity flows to Defender, Purview and the admin center | `instrument-observability` |
| **Phase 3**: Work IQ | The agent can read and act on Microsoft 365 data | `add-workiq-tools` |
| **Phase 4**: Test and verify | Confirmation that all of the above actually works | `test-local` |

If you only need visibility, stop after Phase 2. If you don't need Microsoft 365 data access, skip
Phase 3 entirely.

The S2S guide has its own phase order: local execution, inbound API authorization, agent registration,
observability, then verification. It uses webhook requests and a replay harness instead of
`test-local`, which targets AI teammate messaging, and doesn't add Work IQ.
