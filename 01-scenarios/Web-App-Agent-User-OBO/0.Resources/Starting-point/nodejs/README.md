# Starting point — Node.js + LangChain, Express web app

> This is the **un-instrumented starting point** for the
> [Web App Agent — User OBO](../../../3.Runbook.md) scenario. It has no Agent 365 code in it at all.
> That is deliberate — the runbook walks you through adding it.

A Microsoft ecosystem research assistant built with **LangChain (TypeScript)**, **Azure OpenAI** and
the official [Microsoft Learn MCP server](https://learn.microsoft.com/api/mcp), served as a small
**Express** web app with a chat page.

It is the Node.js counterpart of the [.NET](../dotnet/) and [Python](../python/) starting points:
same behaviour, same system prompt, same Azure OpenAI deployment, different stack.

## Why LangChain here

The Microsoft Agent Framework ships for .NET, Python and Go, so there is no JavaScript or TypeScript
build of it to use. That leaves the choice of framework up to us, and the
`instrument-observability` skill narrows it considerably: it auto-instruments LangChain, the OpenAI
Agents SDK and the Claude Agent SDK on Node, and only soft-warns for Semantic Kernel and Google ADK.
Picking LangChain means Phase 2 of the runbook gives us `chat` spans without hand-writing an
`InferenceScope` around every model call, and it keeps this sample a close sibling of the Python one.

## Prerequisites

- Node.js 20.10 or later, which is what `tsx` and the LangChain 1.x packages expect
- The Azure CLI, signed in to the tenant that owns the Azure OpenAI resource:

  ```powershell
  az login --tenant <tenant-id>
  ```

  The agent authenticates to Azure OpenAI with **Entra ID by default**, so your account needs
  the *Cognitive Services OpenAI User* role on the resource. Key auth is available as an
  alternative via `AZURE_OPENAI_API_KEY`, but many tenants disable keys by policy, and Entra
  credentials are the recommended path regardless.

## Configuration

Copy `.env.example` to `.env` and fill it in:

```powershell
Copy-Item .env.example .env
```

| Setting | Purpose |
| --- | --- |
| `AZURE_OPENAI_ENDPOINT` | The Azure OpenAI resource endpoint |
| `AZURE_OPENAI_DEPLOYMENT` | The chat deployment name |
| `AZURE_OPENAI_API_VERSION` | Azure OpenAI REST API version |
| `AZURE_OPENAI_API_KEY` | Optional. Leave blank to use Entra credentials (recommended) |
| `AZURE_OPENAI_TENANT_ID` | Tenant that owns the resource, see below |
| `AZURE_OPENAI_USE_MANAGED_IDENTITY` | `false` locally, `true` when hosted on Azure |
| `LEARN_MCP_ENDPOINT` | Microsoft Learn MCP server, streamable HTTP |

`.env` is gitignored.

`AZURE_OPENAI_TENANT_ID` is not optional in a multi-tenant setup. The Azure CLI credential will
happily hand back a token from whichever tenant it last used, and Azure OpenAI then answers
`HTTP 400 Tenant provided in token does not match resource token`. Pinning the tenant avoids it.

## Running

Open **this folder** in VS Code and press <kbd>F5</kbd>. That installs dependencies, starts the app
with the debugger attached, and opens the browser on <http://127.0.0.1:8000>.

From a terminal instead:

```powershell
npm install
npm start
```

`npm run dev` does the same thing with `tsx watch`, restarting on every file change. There is no
build step in either case — `tsx` runs the TypeScript directly. `npm run build` is there for when
you want a compiled `dist/` to deploy.

## How it works

```
src/
  config.ts           settings from .env
  agent.ts            the agent: Learn MCP tools + Azure OpenAI + conversation memory
  main.ts             Express host, /api/chat and /api/info
public/               the chat page
```

- **Tools.** `MultiServerMCPClient` connects to the Learn MCP server over streamable HTTP once at
  startup and discovers its tools (`microsoft_docs_search`, `microsoft_code_sample_search`,
  `microsoft_docs_fetch`), which are handed to the agent as LangChain tools.
- **The agent loop.** `createAgent` from the `langchain` package builds the tool-calling loop. The
  system prompt tells it to search Learn before answering and to cite the source urls, which is why
  replies end in a list of `learn.microsoft.com` links.
- **Memory.** `MemorySaver` keeps one conversation per `thread_id`; the chat page generates a fresh
  id, and "New chat" simply generates another. Memory is process local by design, so a restart
  clears every conversation.
- **Authentication.** `AzureCliCredential` locally, `DefaultAzureCredential` when
  `AZURE_OPENAI_USE_MANAGED_IDENTITY` is `true`. There is no IMDS endpoint on a laptop, so managed
  identity is skipped entirely rather than attempted and caught.

## Notes on the dependencies

**`langchain` is pinned to the 1.x range.** The `latest` tag on npm currently points at a `2.0.0-dev`
build rather than a stable release, so an unpinned `npm install langchain` pulls in a prerelease
whose `createAgent` surface has already moved. The `^1.5.4` range in `package.json` keeps you on the
stable line; revisit it when 2.0 ships properly.

**The MCP transport is called `http`, not `streamable_http`.** That trips people up when porting the
Python sample across, because `langchain-mcp-adapters` on Python spells the same transport
`streamable_http`. On Node the accepted values are `http` and `sse`, and `http` is the streamable one.

## Notes on serving the chat page

`res.sendFile` is called with a `root` option rather than one absolute path. That looks fussy, but
`send` treats any dot-prefixed segment of the path it is given as a hidden file and refuses to serve
it — so if you clone this repo into a folder like `C:\Users\you\.tools\`, an absolute path turns
every page load into a 404 with nothing obviously wrong. Scoping the lookup to `root` limits the
dotfile check to `index.html`, where it belongs.

## Next step

This agent is intentionally free of Agent 365 plumbing. Onboarding — agent identity, blueprint,
observability — is what the runbook adds.

➡️ **[Go to the runbook](../../../3.Runbook.md)**

When you reach Phase 2, note that the runbook's Python warning about initialisation order applies
here too: the observability distro patches libraries as they load, so the
`useMicrosoftOpenTelemetry()` call has to come before `src/agent.ts` is imported.
