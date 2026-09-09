# Installing the Agent 365 Skills

Install the [Agent 365 Skills](https://github.com/microsoft/agent365-skills) only if we're following a skill-led runbook. All four scenarios also have a complete manual registration and instrumentation path; choose its link in the [scenario index](../01-scenarios/README.md) to work without a coding assistant.

For the skill-led route, choose the section matching our assistant and run installation from our agent's project directory, so the skills see the intended code.

## Which install route applies to you

| Your coding assistant | Install route |
| --- | --- |
| Claude Code (desktop, web) | [Plugin marketplace](#claude-code) |
| Claude Code CLI | [Plugin marketplace, or `--plugin-dir`](#claude-code-cli) |
| GitHub Copilot CLI | [`gh skill add`](#github-copilot-cli) |
| VS Code agent mode / GitHub Copilot coding agent | [`gh skill add`, or `.agents/skills/`](#vs-code-agent-mode-and-the-copilot-coding-agent) |
| Cursor, Windsurf, Codex CLI, Gemini CLI, or any other agentskills.io-compatible tool | [`.agents/skills/`](#any-other-agentskillsio-compatible-tool) |

All routes install the **same skills**. The difference is only where the files land and how the tool
discovers them.

## Claude Code

Run these inside an active Claude Code session:

```
/plugin marketplace add https://github.com/microsoft/agent365-skills
/plugin install agent365@agent365-skills
```

The marketplace supplies the plugin, and the second command installs its skills for the assistant.

## Claude Code CLI

If you installed the plugin from the marketplace as above, the CLI picks it up automatically on
every `claude` invocation. To load it from a local clone instead:

```bash
cd my-agent-project
claude --plugin-dir "/path/to/agent365-skills/plugins/agent365"
```

This loads the plugin from our local skills checkout for that CLI invocation.

## GitHub Copilot CLI

```bash
gh skill add microsoft/agent365-skills
```

This reads the repository's marketplace manifest and installs the skills into your Copilot CLI
session. Verify with `/skills list`, then drive them in natural language:

```
Set up Agent 365 for this agent
Add observability to this agent
```

These prompts invoke setup and instrumentation after the assistant has discovered the installed skills.

## VS Code agent mode and the Copilot coding agent

`gh skill add microsoft/agent365-skills` also works here. To install the skills into the project
itself, so they travel with the repository and are available to the Copilot coding agent, run the
installer from a local clone of the skills repository:

```bash
cd my-agent-project
node /path/to/agent365-skills/scripts/install.js
```

This copies the skill directories into `.agents/skills/` in your project. They then appear in VS
Code's Configure Skills menu and are loaded on demand.

## Any other agentskills.io-compatible tool

`.agents/skills/` is an open standard, so the installer above is the route for every other assistant
that reads it: Cursor, Windsurf, OpenAI Codex CLI, Gemini CLI, and others:

```bash
cd my-agent-project
node /path/to/agent365-skills/scripts/install.js
```

If your tool does not read `.agents/skills/` yet, you can still copy the individual skill folders
into whatever directory it uses for custom instructions. Each skill is a self-contained Markdown
file with no runtime dependency on the host tool.

## Verify the install

Ask your assistant to run the entry-point skill:

```
Set up Agent 365 for this agent
```

It should recognise `a365-setup` and start by checking the Agent 365 CLI and your Azure login. If
nothing happens, the skills are not visible to the tool. Re-run the install from the project
directory and confirm the tool is reading that directory as its workspace.

## No coding assistant at all

Use the dedicated manual runbook rather than extracting instructions from a skill-led walkthrough:

| Scenario | Manual runbook |
| --- | --- |
| Web app, user OBO | [Manual](../01-scenarios/Web-App-Agent-User-OBO/3.Runbook-Manual.md) |
| Teams, custom engine OBO | [Manual](../01-scenarios/Teams-Agent-Custom-Engine-OBO/3.Runbook-Manual.md) |
| AI Teammate / Autopilot | [Manual](../01-scenarios/AI-Teammate-Agent-Identity/3.Runbook-Manual.md) |
| Service-to-service | [Manual](../01-scenarios/Service-to-Service-Agent/3.Runbook-Manual.md) |

## Wrapping up

With skills installed, continue with the chosen scenario's skill-led guide. On the manual route, skip skill installation and follow its CLI and source-edit instructions directly. S2S uses webhook requests for verification; `test-local` and Agents Playground are for messaging agents.
