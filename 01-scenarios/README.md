# Scenarios

Each scenario is a complete onboarding journey: an un-instrumented agent, and the runbook that turns
it into an Agent 365 agent.

## Available scenarios

| Scenario | Onboarding path | Stacks | Hosting | Status |
| --- | --- | --- | --- | --- |
| [Web App Agent — User OBO](Web-App-Agent-User-OBO/) | User on-behalf-of | .NET Agent Framework, Python + LangChain | Web app (Blazor / FastAPI) | 🚧 In progress |
| [Teams Agent — Custom Engine OBO](Teams-Agent-Custom-Engine-OBO/) | Custom engine agent OBO | .NET Agent Framework, Python + LangChain | Teams / M365 Copilot | 🚧 In progress |
| [AI Teammate — Agent Identity](AI-Teammate-Agent-Identity/) | Agent's own identity | .NET Agent Framework | Teams / M365 Copilot | 🚧 In progress |

The three scenarios are organised by **onboarding path**, not by stack, because the path is what
changes the work. Within a scenario, .NET and Python appear as parallel variants of the same steps.

> **Note on the AI Teammate scenario:** it ships a .NET starting point only. There is no Python
> equivalent in the reference agents, and we would rather say so than publish an untested one.

## The agents themselves are all the same

Deliberately. Every starting point is the same **Microsoft ecosystem research assistant**: it answers
questions about Microsoft products by searching the official
[Microsoft Learn MCP server](https://learn.microsoft.com/api/mcp) and grounding its answers in what
it retrieves.

Keeping the agent logic identical across scenarios means the only thing that differs between two
runbooks is the onboarding itself. That's what you're here to learn.

## Scenario structure

Every scenario folder follows the same layout:

| File / folder | Contents |
| --- | --- |
| `0.Resources/` | `Images/` for screenshots and diagrams, `Starting-point/` for the un-instrumented agent |
| `1.Overview.md` | What the scenario is, who it's for, in scope / out of scope |
| `2.Architecture.md` | How the pieces fit together, and the token flow |
| `3.Runbook.md` | The phased, step-by-step onboarding guide |
| `4.Sample-prompts.md` | Prompts to exercise the finished agent |

## Runbook phases

Every runbook uses the same phases, and **each is a valid stopping point**:

| Phase | What you get | Skill |
| --- | --- | --- |
| **Phase 0** — Prerequisites | A working starting point and the tooling installed | — |
| **Phase 1** — Registration | The agent exists as an identity in your tenant | `a365-setup`, `make-a365-agent` / `make-ai-teammate` |
| **Phase 2** — Observability | Agent activity flows to Defender, Purview and the admin center | `instrument-observability` |
| **Phase 3** — Work IQ | The agent can read and act on Microsoft 365 data | `add-workiq-tools` |
| **Phase 4** — Test and verify | Confirmation that all of the above actually works | `test-local` |

If you only need visibility, stop after Phase 2. If you don't need Microsoft 365 data access, skip
Phase 3 entirely.

## Adding a new scenario

1. Create a folder under `01-scenarios/` using `PascalCase-With-Hyphens`.
2. Add the four numbered documents and a `0.Resources/` folder.
3. Add an un-instrumented starting point under `0.Resources/Starting-point/`, and **verify it builds
   and answers a question before writing the runbook**.
4. Strip every tenant-specific value from the starting point's configuration — no GUIDs, no real
   endpoints, no secrets.
5. Add a row to the table at the top of this file.
