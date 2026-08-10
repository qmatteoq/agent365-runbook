# Agent 365 Runbooks

Step-by-step runbooks for bringing **your own** agent into [Microsoft Agent 365](https://learn.microsoft.com/microsoft-agent-365/) — identity, observability, Microsoft 365 data access, and messaging.

Each scenario starts from a **working agent that has no Agent 365 code in it at all**, and walks you through onboarding it yourself. You run the steps; you end up with an instrumented agent and an understanding of what changed and why.

## How this repo is different from a sample gallery

Most samples hand you the finished result. That tells you *what* correct looks like, but not *how* to get there from the agent you already have — which is the actual problem.

Here, the code you clone is deliberately **un-instrumented**. Every runbook takes you from that starting point to a fully onboarded agent, one phase at a time, with a verification step at the end of each phase so you find out immediately when something is wrong rather than three phases later.

## The onboarding path is driven by skills

The primary route through every runbook is the **Agent 365 Skills** — a set of six skills you install into your coding assistant (Claude Code, GitHub Copilot CLI, or VS Code agent mode) and drive in natural language.

```
gh skill add microsoft/agent365-skills
```

| Skill | What it does |
| --- | --- |
| `a365-setup` | Installs the Agent 365 CLI, validates Azure prerequisites, detects your stack, routes you to the right path |
| `make-a365-agent` | Registers a Blueprint for agents needing observability or catalog visibility, without the messaging layer |
| `instrument-observability` | Wires OpenTelemetry and the Agent 365 tracing exporter |
| `add-workiq-tools` | Connects Work IQ MCP servers — Mail, Calendar, Word and more |
| `make-ai-teammate` | Adds Messaging and Notifications so the agent can receive Teams messages, email and @mentions |
| `test-local` | Launches the agent alongside AgentsPlayground for local smoke testing |

**But every runbook also shows you what the skill did.** Each step is structured as:

> **What you type** → **what the skill does** → **the CLI commands and SDK code behind it** → **how to verify it worked**

That matters for three reasons. You need to review the changes before they reach production. You need to reproduce them in a pipeline where no coding assistant is running. And when a skill does the wrong thing for your architecture — which we document where we found it — you need to know enough to correct it.

## Scenarios

| Scenario | Onboarding path | Stacks | Hosting |
| --- | --- | --- | --- |
| [Web App Agent — User OBO](01-scenarios/Web-App-Agent-User-OBO/) | User on-behalf-of | .NET, Python | Web app |
| [Teams Agent — Custom Engine OBO](01-scenarios/Teams-Agent-Custom-Engine-OBO/) | Custom engine agent OBO | .NET, Python | Teams / M365 Copilot |
| [AI Teammate — Agent Identity](01-scenarios/AI-Teammate-Agent-Identity/) | Agent's own identity | .NET | Teams / M365 Copilot |

Not sure which applies to you? Start with
[Choosing Your Onboarding Path](02-patterns/Choosing-Your-Onboarding-Path.md), which walks the
decision and lists what each path costs you.

## Repository structure

| Path | Contents |
| --- | --- |
| [`00-overview/`](00-overview/) | What Agent 365 onboarding involves, the skills, and the concepts the runbooks assume |
| [`01-scenarios/`](01-scenarios/) | The runbooks, one folder per scenario, each with its own starting-point code |
| [`02-patterns/`](02-patterns/) | Cross-cutting guidance that applies to more than one scenario |
| [`03-references/`](03-references/) | Troubleshooting, known skill gaps, and environment gotchas |

Each scenario folder follows the same layout:

```
<Scenario-Name>/
├── 0.Resources/
│   ├── Images/
│   └── Starting-point/      ← the un-instrumented agent you begin from
├── 1.Overview.md            ← what this scenario is and who it is for
├── 2.Architecture.md        ← how the pieces fit, and the token flow
├── 3.Runbook.md             ← the step-by-step onboarding guide
└── 4.Sample-prompts.md      ← prompts to exercise the finished agent
```

## Seeing the finished result

Every starting point in this repo corresponds to a fully instrumented agent in
[**qmatteoq/agent365-demos**](https://github.com/qmatteoq/agent365-demos). If a step doesn't
behave as described, compare against the finished version there.

## Prerequisites

The runbooks assume you already have a working agent, or are using one of the starting points here. Beyond that you need an Azure subscription, a Microsoft 365 tenant with Agent 365 enabled, and appropriate licensing. Each runbook lists its own specific prerequisites in Phase 0.

## Disclaimer

This repository is a community resource and is not an official Microsoft product. Agent 365 is
evolving; commands, scopes and identifiers change. Verify against the
[official Agent 365 documentation](https://learn.microsoft.com/microsoft-agent-365/) before
relying on anything here in production.
