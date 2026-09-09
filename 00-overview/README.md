# Overview: Onboarding an agent into Agent 365

This section introduces the four scenarios and the concepts shared by their skill-led and manual runbooks.

## What onboarding actually means

An agent already reasons, calls tools and responds to messages or business events. Agent 365 onboarding can add these capabilities:

| Capability | What it gives you | Optional skill |
| --- | --- | --- |
| **Identity** | The agent exists as a first-class object in your tenant, with its own registration and permissions | `a365-setup`, `make-a365-agent` |
| **Observability** | Agent activity appears in Microsoft Defender, Microsoft Purview and the Microsoft 365 admin center | `instrument-observability` |
| **Microsoft 365 data** | The agent can read and act on Mail, Calendar, files and more through Work IQ MCP servers | `add-workiq-tools` |
| **Messaging** | An AI Teammate has Microsoft 365 presence; supported channels and handlers determine which messages and events it receives | `make-ai-teammate` |

We don't need every capability. Registration and observability are common to all four scenarios; Work IQ is optional where supported, and the S2S webhook does not need teammate messaging or an agent user. Follow the chosen runbook's checkpoints, since registration alone does not produce activity telemetry.

## The key decision: whose identity acts?

Every other choice follows from this. When your agent calls Microsoft Graph, or writes a telemetry
span, some identity is doing it. 

| Path | Who acts | When to use it |
| --- | --- | --- |
| **User OBO** | The signed-in user, delegated to the agent | The agent is a tool a person drives. A web app where the user signs in. |
| **Custom engine agent OBO** | The user, but obtained via the Teams/M365 channel rather than an interactive sign-in | The agent is hosted in Teams or M365 Copilot and acts for whoever messages it |
| **Agent identity (AI Teammate)** | The agent with its own user account | The agent needs a mailbox, Microsoft 365 presence or user-based resources |
| **Service-to-service (S2S)** | The agent identity, using application permissions | A webhook, scheduler or another service starts work without a signed-in user |

The path changes which token you acquire, which endpoint you
export telemetry to, and how activity is attributed in reporting. See
[Choosing Your Onboarding Path](../02-patterns/Choosing-Your-Onboarding-Path.md) for how to
decide, and [Token chains by onboarding path](../02-patterns/The-Three-Token-Chains.md) for what each
choice commits you to.

## Where your telemetry ends up

Once observability is wired, spans flow to three surfaces, and **they do not all accept the same
data**:

| Surface | What it ingests |
| --- | --- |
| **Microsoft Defender** (advanced hunting, `CloudAppEvents`) | Every operation: `InvokeAgent`, `InferenceCall`, `ExecuteToolBySDK`, `ExecuteToolByGateway`, `ExecuteToolByMCPServer` |
| **Microsoft 365 admin center** (Agent Activity) | `invoke_agent` rows **only**, and it reads the caller identity off that span |
| **Microsoft Purview** | Content and compliance signals |

## Two ways to complete each scenario

Every scenario has a skill-led `3.Runbook.md` and a manual `3.Runbook-Manual.md`. The [scenario index](../01-scenarios/README.md) links both routes for web OBO, custom engine Teams OBO, AI Teammate and S2S.

For the skill-led route, install the [Agent 365 Skills](https://github.com/microsoft/agent365-skills) using [Installing the Skills](Installing-the-Skills.md), then review the generated changes. For the manual route, use the portal instructions, CLI commands and source edits directly, without installing skills or using a coding assistant. The token and identity requirements are the same whichever route we choose.

The manual guides identify where Work IQ runtime integration is outside their scope. A manifest and tenant consent alone do not give the model callable tools, and S2S downstream APIs need application permissions rather than a delegated Work IQ token.

## What you need before starting

| Requirement | Details |
| --- | --- |
| An agent | Either your own, or one of the starting points in [`01-scenarios/`](../01-scenarios/) |
| Model and hosting resources | Keep our agent's existing provider and hosting. Azure samples need access to the chosen deployment; an Azure OpenAI Entra identity needs the *Cognitive Services OpenAI User* role. The S2S samples can run with stubs and no model resource |
| Microsoft 365 tenant | With Agent 365 enabled and licensing assigned |
| Tenant permissions | Permission to create the required registrations and an administrator authorized to complete consent; see the chosen runbook for its roles and approval steps |
| Agent 365 CLI and build tools | Needed for manual commands and skill-led onboarding |
| A coding assistant and the skills | Only for the skill-led route. See [Installing the Skills](Installing-the-Skills.md); manual runbooks do not require them |

Per-scenario prerequisites are listed in each runbook's Phase 0.

The [S2S starting points](../01-scenarios/Service-to-Service-Agent/1.Overview.md) offer the same tenant-free
stub mode in .NET, Python and Node.js. Their runtimes use explicit noninteractive credentials when
we enable a real model; they don't fall back to an operator's `az login` session.

## Related resources

| Resource | Link |
| --- | --- |
| Agent 365 developer documentation | https://learn.microsoft.com/microsoft-agent-365/ |
| Agent 365 Skills repository | https://github.com/microsoft/agent365-skills |
| Agent 365 Skills announcement | https://techcommunity.microsoft.com/blog/agent-365-blog/agent-365-skills-bring-your-agents-into-microsoft-agent-365-in-minutes/4529838 |

## Wrapping up

Choose the operation's identity path first, then use either runbook for that scenario. A background task needs S2S when it acts with application permissions; it needs an AI Teammate user only when its operations require that user context.
