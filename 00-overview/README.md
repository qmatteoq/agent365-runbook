# Overview: Onboarding an agent into Agent 365

This section covers the concepts every runbook assumes. 

## What onboarding actually means

An agent already reasons, calls tools and answers questions. Onboarding it in Agent 365 adds four things around it:

| Capability | What it gives you | Skill |
| --- | --- | --- |
| **Identity** | The agent exists as a first-class object in your tenant, with its own registration and permissions | `a365-setup`, `make-a365-agent` |
| **Observability** | Agent activity appears in Microsoft Defender, Microsoft Purview and the Microsoft 365 admin center | `instrument-observability` |
| **Microsoft 365 data** | The agent can read and act on Mail, Calendar, files and more through Work IQ MCP servers | `add-workiq-tools` |
| **Messaging** | The agent can be reached over Teams, email and @mentions, and it operates under its own identity. | `make-ai-teammate` |

You do not need all four. The runbooks are phased so you can stop after any one of them and still
have a working, valid agent.

## The key decision: whose identity acts?

Every other choice follows from this. When your agent calls Microsoft Graph, or writes a telemetry
span, some identity is doing it. 

| Path | Who acts | When to use it |
| --- | --- | --- |
| **User OBO** | The signed-in user, delegated to the agent | The agent is a tool a person drives. A web app where the user signs in. |
| **Custom engine agent OBO** | The user, but obtained via the Teams/M365 channel rather than an interactive sign-in | The agent is hosted in Teams or M365 Copilot and acts for whoever messages it |
| **Agent identity (AI Teammate)** | The agent itself, as its own directory principal | The agent acts autonomously, or needs to own resources and act when nobody is present |

The path changes which token you acquire, which endpoint you
export telemetry to, and how activity is attributed in reporting. See
[Choosing Your Onboarding Path](../02-patterns/Choosing-Your-Onboarding-Path.md) for how to
decide, and [The Three Token Chains](../02-patterns/The-Three-Token-Chains.md) for what each
choice commits you to.

## Where your telemetry ends up

Once observability is wired, spans flow to three surfaces, and **they do not all accept the same
data**:

| Surface | What it ingests |
| --- | --- |
| **Microsoft Defender** (advanced hunting, `CloudAppEvents`) | Every operation: `InvokeAgent`, `InferenceCall`, `ExecuteToolBySDK`, `ExecuteToolByGateway`, `ExecuteToolByMCPServer` |
| **Microsoft 365 admin center** (Agent Activity) | `invoke_agent` rows **only**, and it reads the caller identity off that span |
| **Microsoft Purview** | Content and compliance signals |

## The skills

The [Agent 365 Skills](https://techcommunity.microsoft.com/blog/agent-365-blog/agent-365-skills-bring-your-agents-into-microsoft-agent-365-in-minutes/4529838)
are the primary path through these runbooks. They are additive and idempotent. They don't delete or
restructure your code, and re-running one is safe. They work with every major AI coding assistant.
See [Installing the Skills](Installing-the-Skills.md) for the route that matches your tool.

## What you need before starting

| Requirement | Details |
| --- | --- |
| An agent | Either your own, or one of the starting points in [`01-scenarios/`](../01-scenarios/) |
| Azure subscription | For the model deployment (Azure OpenAI or equivalent). The starting points authenticate to it with **Entra credentials by default** (`az login` locally, or a managed identity on Azure), and support an **API key** as an alternative when one is configured. Entra needs the *Cognitive Services OpenAI User* role, and is the only option in tenants where keys are disabled by policy |
| Microsoft 365 tenant | With Agent 365 enabled and licensing assigned |
| Tenant permissions | Sufficient to register applications and grant admin consent (Global Administrator or AI Administrator) |
| A coding assistant | Any of the major ones: Claude Code, GitHub Copilot CLI, VS Code agent mode, Cursor, Windsurf, Codex CLI, Gemini CLI. Optional: every step also documents the manual CLI and SDK equivalent |
| The skills | Installed into that assistant. See [Installing the Skills](Installing-the-Skills.md) |

Per-scenario prerequisites are listed in each runbook's Phase 0.

## Related resources

| Resource | Link |
| --- | --- |
| Agent 365 developer documentation | https://learn.microsoft.com/microsoft-agent-365/ |
| Agent 365 Skills repository | https://github.com/microsoft/agent365-skills |
| Agent 365 Skills announcement | https://techcommunity.microsoft.com/blog/agent-365-blog/agent-365-skills-bring-your-agents-into-microsoft-agent-365-in-minutes/4529838 |
