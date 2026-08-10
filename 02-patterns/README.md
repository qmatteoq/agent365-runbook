# Patterns

Cross-cutting guidance that applies to more than one scenario. Where a runbook needs one of these,
it links here rather than repeating it.

## Currently available patterns

| Pattern | What it covers | Status |
| --- | --- | --- |
| [Choosing Your Onboarding Path](Choosing-Your-Onboarding-Path.md) | How to decide between user OBO, custom engine agent OBO, and agent identity | ✅ Written |
| [Identity Separation](Identity-Separation.md) | Why the hosting app's identity and the agent blueprint must stay separate principals | ✅ Written |
| [The Three Token Chains](The-Three-Token-Chains.md) | What token each path acquires, from which authority, for which audience | ✅ Written |

## Adding a new pattern

1. Add `<Pattern-Name>.md` using `PascalCase-With-Hyphens`.
2. Add a row to the table above.
3. Cross-reference it from any scenario runbook that needs it.
