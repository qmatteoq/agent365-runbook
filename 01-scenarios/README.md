# Scenarios

Each of the four scenarios has a skill-led and a manual onboarding runbook, with .NET, Python and Node.js examples. We can use our own agent or an optional educational sample; the sample workflow is not an Agent 365 requirement.

## Available scenarios

| Scenario | Onboarding path | Stacks | Hosting | Runbooks |
| --- | --- | --- | --- | --- |
| [Web App Agent: User OBO](Web-App-Agent-User-OBO/) | User on-behalf-of | .NET Agent Framework, Python + LangChain, Node.js + LangChain | Web app (Blazor / FastAPI / Express) | [Skill-led](Web-App-Agent-User-OBO/3.Runbook.md) and [manual](Web-App-Agent-User-OBO/3.Runbook-Manual.md) |
| [Teams Agent: Custom Engine OBO](Teams-Agent-Custom-Engine-OBO/) | Custom engine agent OBO | .NET Agent Framework, Python + LangChain, Node.js + LangChain | Teams / M365 Copilot | [Skill-led](Teams-Agent-Custom-Engine-OBO/3.Runbook.md) and [manual](Teams-Agent-Custom-Engine-OBO/3.Runbook-Manual.md) |
| [AI Teammate / Autopilot: Agent Identity](AI-Teammate-Agent-Identity/) | Agent's own identity | .NET Agent Framework, Python + LangChain, Node.js + LangChain | Teams / M365 Copilot | [Skill-led](AI-Teammate-Agent-Identity/3.Runbook.md) and [manual](AI-Teammate-Agent-Identity/3.Runbook-Manual.md) |
| [Service-to-service agent](Service-to-Service-Agent/1.Overview.md) | App-only S2S | .NET Agent Framework, Python + LangChain, Node.js + LangChain | Webhook (ASP.NET Core / FastAPI / Express) | [Skill-led](Service-to-Service-Agent/3.Runbook.md) and [manual](Service-to-Service-Agent/3.Runbook-Manual.md) |

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
| `3.Runbook.md` | Skill-led onboarding, with commands and explanations of the generated changes |
| `3.Runbook-Manual.md` | Manual registration and instrumentation, available for every scenario |
| `4.Sample-prompts.md` | Chat prompts or S2S HTTP requests to exercise the sample |

## Runbook phases

The phase order depends on the scenario. Both authoring routes follow that scenario's order:

| Scenario | Phase order |
| --- | --- |
| Web app, user OBO | 0: Run the agent; 1: Sign users in; 2: Register; 3: Observability; 4: Optional Work IQ; 5: Verify |
| Teams, custom engine OBO | 0: Prepare Teams hosting; 1: Register; 2: Observability; 3: Optional Work IQ; 4: Verify |
| AI Teammate / Autopilot | 0: Prepare the application; 1: Register, publish and approve an instance; 2: Observability; 3: Optional Work IQ; 4: Verify |
| Service-to-service | 0: Run the webhook; 1: Protect ingress; 2: Register; 3: Observability; 4: Verify |

If we only need visibility, complete observability and the verification phase, skipping Work IQ. The manual guides cover Work IQ selection and consent but leave runtime integration outside their worked implementations. Existing tool integrations can remain in place.

S2S uses webhook requests and a replay harness, not the messaging-only `test-local` skill. It doesn't add Work IQ: its downstream services need application-permission APIs, and the supplied tools remain stubs until we implement those integrations.

## Wrapping up

Use the identity path to choose a scenario and the authoring route to choose a runbook. The architecture and sample requests apply to both routes; keep the verification expectations within the capabilities we've actually implemented.
