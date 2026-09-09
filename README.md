# Agent 365 Runbooks

Step-by-step runbooks for bringing **your own** agent into [Microsoft Agent 365](https://learn.microsoft.com/microsoft-agent-365/): identity, observability, Microsoft 365 data access, and messaging.

We can onboard our own working agent or use an optional educational sample. All four scenarios have a **skill-led runbook** and a **manual runbook**, with .NET, Python and Node.js examples. The identity path depends on who acts; the choice of a coding assistant does not change it.

## Choose how to work

Use `3.Runbook.md` to work with a coding assistant, or `3.Runbook-Manual.md` to run the CLI and make the source edits ourselves. Both routes cover registration and observability. Work IQ requires separate permissions and runtime tool integration where supported; the S2S scenario does not add it.

### With a coding assistant

The skill-led runbooks use the **Agent 365 Skills**, installed into our chosen assistant:

| Your coding assistant | Install with |
| --- | --- |
| Claude Code (app, web, CLI) | `/plugin marketplace add https://github.com/microsoft/agent365-skills` then `/plugin install agent365@agent365-skills` |
| GitHub Copilot CLI, VS Code agent mode | `gh skill add microsoft/agent365-skills` |
| Cursor, Windsurf, Codex CLI, Gemini CLI, and other agentskills.io-compatible tools | `node /path/to/agent365-skills/scripts/install.js` from your project, which installs into `.agents/skills/` |

Full instructions, including how to verify the install: [Installing the Skills](00-overview/Installing-the-Skills.md).

| Skill | What it does |
| --- | --- |
| `a365-setup` | Installs the Agent 365 CLI, validates Azure prerequisites, detects your stack, routes you to the right path |
| `make-a365-agent` | Registers a Blueprint for agents needing observability or catalog visibility, without the messaging layer |
| `instrument-observability` | Wires OpenTelemetry and the Agent 365 tracing exporter |
| `add-workiq-tools` | Adds selected Work IQ MCP servers and supported runtime wiring; delegated scenarios only |
| `make-ai-teammate` | Adds Messaging and Notifications so the agent can receive Teams messages, email and @mentions |
| `test-local` | Launches an AI Teammate with AgentsPlayground; S2S uses HTTP requests instead |

The skill-led steps also explain the commands and code behind the automation:

> **What you type** → **what the skill does** → **the CLI commands and SDK code behind it** → **how to verify it worked**

Review generated changes against the scenario's identity and telemetry requirements before deployment. The [known skill gaps](03-references/Known-Skill-Gaps.md) describe integration details to check.

### Without a coding assistant

The manual runbooks provide the portal steps, CLI commands and source edits without requiring skills or a coding assistant. Choose the manual link for our scenario below; we don't need to read the skill-led guide first.

For registration, authentication or missing activity, use the [troubleshooting guide](03-references/Troubleshooting.md). It covers all four scenarios and both authoring routes, with checks for the running process, token flow and exported spans.

## Scenarios

| Scenario | Identity and hosting | Skill-led runbook | Manual runbook |
| --- | --- | --- | --- |
| [Web app: User OBO](01-scenarios/Web-App-Agent-User-OBO/1.Overview.md) | Signed-in user's delegated permissions; web app | [Skill-led](01-scenarios/Web-App-Agent-User-OBO/3.Runbook.md) | [Manual](01-scenarios/Web-App-Agent-User-OBO/3.Runbook-Manual.md) |
| [Teams: Custom engine OBO](01-scenarios/Teams-Agent-Custom-Engine-OBO/1.Overview.md) | Teams user's delegated permissions; Azure Bot channel | [Skill-led](01-scenarios/Teams-Agent-Custom-Engine-OBO/3.Runbook.md) | [Manual](01-scenarios/Teams-Agent-Custom-Engine-OBO/3.Runbook-Manual.md) |
| [AI Teammate / Autopilot](01-scenarios/AI-Teammate-Agent-Identity/1.Overview.md) | Agent's own user account; Microsoft 365 presence | [Skill-led](01-scenarios/AI-Teammate-Agent-Identity/3.Runbook.md) | [Manual](01-scenarios/AI-Teammate-Agent-Identity/3.Runbook-Manual.md) |
| [Service-to-service agent](01-scenarios/Service-to-Service-Agent/1.Overview.md) | App-only permissions, no signed-in user; webhook or background work | [Skill-led](01-scenarios/Service-to-Service-Agent/3.Runbook.md) | [Manual](01-scenarios/Service-to-Service-Agent/3.Runbook-Manual.md) |

Not sure which applies to you? Start with
[Choosing Your Onboarding Path](02-patterns/Choosing-Your-Onboarding-Path.md), which walks the
decision and lists what each path costs you.

## Repository structure

| Path | Contents |
| --- | --- |
| [`00-overview/`](00-overview/) | Onboarding concepts and the choice between skill-led and manual authoring |
| [`01-scenarios/`](01-scenarios/) | Four scenarios, each with both runbook paths and optional sample code |
| [`02-patterns/`](02-patterns/) | Cross-cutting guidance that applies to more than one scenario |
| [`03-references/`](03-references/) | Troubleshooting, known skill gaps, and environment gotchas |

Each scenario folder follows the same layout:

```
<Scenario-Name>/
├── 0.Resources/
│   ├── Images/
│   └── Starting-point/      ← optional educational agents without Agent 365 instrumentation
├── 1.Overview.md            ← what this scenario is and who it is for
├── 2.Architecture.md        ← how the pieces fit, and the token flow
├── 3.Runbook.md             ← skill-led onboarding
├── 3.Runbook-Manual.md      ← manual registration and instrumentation
└── 4.Sample-prompts.md      ← chat prompts or S2S HTTP requests for the sample
```

Both runbooks use the same scenario identity model. The sample requests exercise the behavior the chosen implementation actually supports; a stub notification is not a real Teams message.

## Prerequisites
Start with a working agent or an optional sample, then follow the prerequisites in the chosen runbook:

- A Microsoft 365 tenant with Agent 365 enabled, appropriate licensing and permission to register the agent and complete administrator consent.
- Access to the resources our agent uses. Azure model resources are needed only when using that provider; the S2S samples also have a tenant-free stub mode.
- The Agent 365 CLI and our application's build tools. A coding assistant and the skills are needed only for the skill-led route.

## Disclaimer

This repository is a community resource and is not an official Microsoft product. Agent 365 is
evolving; commands, scopes and identifiers change. Verify against the
[official Agent 365 documentation](https://learn.microsoft.com/microsoft-agent-365/) before
relying on anything here in production.

## Wrapping up

Choose the scenario by its identity requirements, then choose either authoring route. The [scenario index](01-scenarios/README.md) lists the phase order and verification method for each.
