# References

Troubleshooting, known gaps, and the environment-specific traps that cost the most time.

## Available references

| Reference | What it covers | Status |
| --- | --- | --- |
| Troubleshooting | Diagnosing telemetry that doesn't arrive, wrong attribution, and export failures | 🚧 Planned |
| [Known Skill Gaps](Known-Skill-Gaps.md) | Where the Agent 365 Skills do the wrong thing, and how to correct it | ✅ Written |
| Environment Gotchas | Platform-specific problems: Windows on ARM, dev tunnels, credential overwrites | 🚧 Planned |

## Why "Known Skill Gaps" exists

The Agent 365 Skills automate most of the onboarding work, and the runbooks use them as the primary
path. But automation that silently does the wrong thing is worse than no automation, because you
don't find out until you're debugging production telemetry.

Where we hit a gap building the reference agents, we record it here with: what we asked for, what
the skill produced, why it was wrong, and what to do instead. These are point-in-time observations
against a preview product. Re-verify before assuming a gap still exists.

## Useful resources

| Resource | Link |
| --- | --- |
| Agent 365 developer documentation | https://learn.microsoft.com/microsoft-agent-365/ |
| Agent 365 observability concepts | https://learn.microsoft.com/microsoft-agent-365/developer/observability-concepts |
| Agent 365 Skills repository | https://github.com/microsoft/agent365-skills |
| Fully instrumented reference agents | https://github.com/qmatteoq/agent365-demos |
