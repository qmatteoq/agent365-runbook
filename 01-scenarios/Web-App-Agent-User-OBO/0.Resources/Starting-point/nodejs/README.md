# Starting point: Node.js + LangChain, Express web app

> This optional educational sample has no Agent 365 instrumentation yet. Use the
> [skill-led](../../../3.Runbook.md) or [manual](../../../3.Runbook-Manual.md) guide to add it,
> or apply the same onboarding steps to our own web agent.

A Microsoft ecosystem research assistant built with **LangChain (TypeScript)**, **Azure OpenAI** and
the official [Microsoft Learn MCP server](https://learn.microsoft.com/api/mcp), served as a small
**Express** web app with a chat page.

It is the Node.js counterpart of the [.NET](../dotnet/) and [Python](../python/) starting points:
same behaviour, same system prompt, same Azure OpenAI deployment, different stack.

The app already includes Microsoft Entra sign-in, but it stays dormant until we configure it. That
matters because Phase 0 asks us to run the sample before the Agent 365 blueprint exists. With the
Entra settings blank, the chat page runs anonymously. After the runbook creates the app registration
and the blueprint, we fill in the settings and the same app starts requiring sign-in. At that point
it asks Entra for a token scoped to `api://<blueprint-app-id>/access_agent_as_user`, which is the
first user token in the OBO chain.

## Why LangChain here

The Microsoft Agent Framework ships for .NET, Python and Go, so there is no JavaScript or TypeScript
build of it to use. This sample uses LangChain, matching the Python sample's orchestration.
The observability distro can instrument its model calls when initialized before the framework
loads, on either authoring route. For our own agent, keep its framework and check whether that
integration emits the required spans or needs explicit scopes.

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
| `AZURE_AD_TENANT_ID` | Tenant that owns the web app registration |
| `AZURE_AD_CLIENT_ID` | Client id of the web app registration |
| `AZURE_AD_CLIENT_SECRET` | Client secret for the web app registration |
| `AZURE_AD_REDIRECT_URI` | Redirect URI registered on the web app, defaults to `http://localhost:8000/signin-oidc` |
| `AGENTS365OBSERVABILITY__AGENTBLUEPRINTID` | Agent blueprint app id written by the Agent 365 CLI |
| `HOST` | Local host name Express binds to, defaults to `localhost` |
| `PORT` | Local port, defaults to `8000` |

`.env` is gitignored.

`AZURE_OPENAI_TENANT_ID` is not optional in a multi-tenant setup. The Azure CLI credential will
happily hand back a token from whichever tenant it last used, and Azure OpenAI then answers
`HTTP 400 Tenant provided in token does not match resource token`. Pinning the tenant avoids it.

The sign-in settings use the same decision point as Azure OpenAI authentication: if the required
values are blank, the app runs anonymously. If `AZURE_AD_TENANT_ID`, `AZURE_AD_CLIENT_ID`,
`AZURE_AD_CLIENT_SECRET`, `AZURE_AD_REDIRECT_URI` and `AGENTS365OBSERVABILITY__AGENTBLUEPRINTID` all
have values, the app mounts `/signin`, `/signin-oidc`, `/signout` and `/api/me`, then requires a
signed-in user for `/api/chat`.

When the runbook asks us to create the Entra app registration, we add this redirect URI:

```text
http://localhost:8000/signin-oidc
```

That URI matches the sample's default host. We use `localhost` rather than `127.0.0.1` because the
browser treats them as different origins. If we browse to `127.0.0.1` but Entra redirects to
`localhost`, the session cookie created before sign-in is not sent back on the callback, and the app
looks as if it lost the sign-in session.

> Keep the host name and redirect URI aligned when you change either value. If you set `HOST` to
> `127.0.0.1`, also register and configure `AZURE_AD_REDIRECT_URI` with `127.0.0.1`.

## Running

Open **this folder** in VS Code and press <kbd>F5</kbd>. That installs dependencies, starts the app
with the debugger attached, and opens the browser on <http://localhost:8000>.

From a terminal instead:

```powershell
npm install
npm start
```

`npm run dev` does the same thing with `tsx watch`, restarting on every file change. There is no
build step in either case, `tsx` runs the TypeScript directly. `npm run build` is there for when
you want a compiled `dist/` to deploy.

On startup, the log tells us whether Entra sign-in is disabled and the app is anonymous, or enabled
and requesting the Agent 365 blueprint scope.

## How it works

```
src/
  config.ts           settings from .env
  auth.ts             optional Entra sign-in + server-side session store
  agent.ts            the agent: Learn MCP tools + Azure OpenAI + conversation memory
  main.ts             Express host, /api/chat, /api/info and optional auth routes
public/               the chat page
```

The layout keeps sign-in separate from the agent code. That way the Learn MCP tooling, Azure OpenAI
model setup and conversation memory stay the same whether the sample is running anonymously or with
Entra sign-in enabled.

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
- **User sign-in.** `ConfidentialClientApplication` from `@azure/msal-node` drives the authorization
  code flow when the Entra settings are complete. The app stores MSAL's PKCE verifier and state
  server-side, keeps only an opaque session id in an HTTP-only cookie, and later uses
  `acquireUserAssertion()` to return the blueprint-scoped access token for the signed-in user.

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
it, so if you clone this repo into a folder like `C:\Users\you\.tools\`, an absolute path turns
every page load into a 404 with nothing obviously wrong. Scoping the lookup to `root` limits the
dotfile check to `index.html`, where it belongs.

## Wrapping up

This starting point is still free of Agent 365 instrumentation. The web app sign-in hook is in place
for the user OBO path, ready for the moment the runbook has created the blueprint and the Entra app
registration. We can run the sample anonymously at first, then turn on sign-in by filling in the
Entra settings without changing the code.

Choose the [skill-led runbook](../../../3.Runbook.md) or the
[manual runbook](../../../3.Runbook-Manual.md), which requires no coding assistant.

When you reach the observability phase, note that the runbook's Python warning about initialisation order applies
here too: the observability distro patches libraries as they load, so the
`useMicrosoftOpenTelemetry()` call has to come before `src/agent.ts` is imported.
