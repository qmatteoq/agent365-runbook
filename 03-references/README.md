# References

Troubleshooting, known gaps, and the environment-specific traps that cost the most time.

## Available references

| Reference | What it covers | Status |
| --- | --- | --- |
| Scenario troubleshooting | Identity, ingestion and host diagnostics in each runbook; links below | Available in all four scenarios |
| [Known Skill Gaps](Known-Skill-Gaps.md) | Where the Agent 365 Skills do the wrong thing, and how to correct it | ✅ Written |
| Environment Gotchas | Platform-specific problems: Windows on ARM, dev tunnels, credential overwrites | 🚧 Planned |

## Why "Known Skill Gaps" exists

The skill-led runbooks automate onboarding through the Agent 365 Skills. The manual runbooks make
the registration and instrumentation changes without an assistant. SDK configuration, token
identity and initialization-order problems can affect either route, so the relevant checks apply
even when we write the code ourselves.

Where we hit a gap building the reference agents, we record it here with: what we asked for, what
the skill produced, why it was wrong, and what to do instead. These are point-in-time observations
against a preview product. Re-verify before assuming a gap still exists.

## Find the guidance for our scenario

| Scenario | Skill-led runbook | Manual runbook |
| --- | --- | --- |
| Web app, user OBO | [Skill-led](../01-scenarios/Web-App-Agent-User-OBO/3.Runbook.md) | [Manual](../01-scenarios/Web-App-Agent-User-OBO/3.Runbook-Manual.md) |
| Teams, custom engine OBO | [Skill-led](../01-scenarios/Teams-Agent-Custom-Engine-OBO/3.Runbook.md) | [Manual](../01-scenarios/Teams-Agent-Custom-Engine-OBO/3.Runbook-Manual.md) |
| AI Teammate / Autopilot | [Skill-led](../01-scenarios/AI-Teammate-Agent-Identity/3.Runbook.md) | [Manual](../01-scenarios/AI-Teammate-Agent-Identity/3.Runbook-Manual.md) |
| Service-to-service | [Skill-led](../01-scenarios/Service-to-Service-Agent/3.Runbook.md) | [Manual](../01-scenarios/Service-to-Service-Agent/3.Runbook-Manual.md) |

For S2S, separate incoming API authorization failures from outbound agent-token or export failures.
The [sample requests](../01-scenarios/Service-to-Service-Agent/4.Sample-prompts.md) cover valid
events, replays and rejections; a replay should not create another agent run.

## Useful resources

| Resource | Link |
| --- | --- |
| Agent 365 developer documentation | https://learn.microsoft.com/microsoft-agent-365/ |
| Agent 365 observability concepts | https://learn.microsoft.com/microsoft-agent-365/developer/observability-concepts |
| Agent 365 Skills repository | https://github.com/microsoft/agent365-skills |
| Fully instrumented reference agents | https://github.com/qmatteoq/agent365-demos |

## Wrapping up

Use the diagnostics for the operation's identity path, then compare its token and span requirements
with [Token chains by onboarding path](../02-patterns/The-Three-Token-Chains.md). A successful HTTP
export alone does not establish that the expected activity reached tenant reporting.
