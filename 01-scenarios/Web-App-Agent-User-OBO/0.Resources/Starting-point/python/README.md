# Starting point: Python + LangChain, FastAPI web app

> This is the **un-instrumented starting point** for the
> [Web App Agent: User OBO](../../../3.Runbook.md) scenario. It has no Agent 365 code in it at all.
> That is deliberate, the runbook walks you through adding it.

A Microsoft ecosystem research assistant built with **LangChain (Python)**, **Azure OpenAI** and the
official [Microsoft Learn MCP server](https://learn.microsoft.com/api/mcp), served as a small
**FastAPI** web app with a chat page.

It is the Python counterpart of the [.NET starting point](../dotnet/): same behaviour, same system
prompt, same Azure OpenAI deployment, different stack.

The app already includes Microsoft Entra sign-in, but it stays dormant until we configure it. That
matters because Phase 0 asks us to run the sample before the Agent 365 blueprint exists. With the
Entra settings blank, the chat page runs anonymously. After the runbook creates the app registration
and the blueprint, we fill in the settings and the same app starts requiring sign-in. At that point
it asks Entra for a token scoped to `api://<blueprint-app-id>/access_agent_as_user`, which is the
first user token in the OBO chain.

## Prerequisites

- [uv](https://docs.astral.sh/uv/) for dependency management and the runner
- Python 3.12
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
| `HOST` | Local host name used by Uvicorn, defaults to `localhost` |
| `PORT` | Local port used by Uvicorn, defaults to `8000` |

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

Open **this folder** in VS Code and press <kbd>F5</kbd>. That syncs dependencies, starts the app
with the debugger attached, and opens the browser on <http://localhost:8000>.

From a terminal instead:

```powershell
uv run python -m app.main
```

The command starts the FastAPI host with the settings in `.env`. On startup, the log tells us whether
Entra sign-in is disabled and the app is anonymous, or enabled and requesting the Agent 365 blueprint
scope.

## How it works

```
app/
  config.py           settings from .env
  auth.py             optional Entra sign-in + server-side session store
  agent.py            the agent: Learn MCP tools + Azure OpenAI + conversation memory
  main.py             FastAPI host, /api/chat, /api/info and optional auth routes
  static/             the chat page
```

The layout keeps sign-in separate from the agent code. That way the Learn MCP tooling, Azure OpenAI
model setup and conversation memory stay the same whether the sample is running anonymously or with
Entra sign-in enabled.

- **Tools.** `MultiServerMCPClient` connects to the Learn MCP server over streamable HTTP once at
  startup and discovers its tools (`microsoft_docs_search`, `microsoft_code_sample_search`,
  `microsoft_docs_fetch`), which are handed to the agent as LangChain tools.
- **The agent loop.** `langchain.agents.create_agent` builds the tool-calling loop. The system
  prompt tells it to search Learn before answering and to cite the source urls, which is why replies
  end in a list of `learn.microsoft.com` links.
- **Memory.** `InMemorySaver` keeps one conversation per `thread_id`; the chat page generates a
  fresh id, and "New chat" simply generates another. Memory is process local by design, so a restart
  clears every conversation.
- **Authentication.** `AzureCliCredential` locally, `DefaultAzureCredential` when
  `AZURE_OPENAI_USE_MANAGED_IDENTITY` is `true`. There is no IMDS endpoint on a laptop, so managed
  identity is skipped entirely rather than attempted and caught.
- **User sign-in.** `msal.ConfidentialClientApplication` drives the authorization code flow when the
  Entra settings are complete. The app stores MSAL's flow dictionary server-side, keeps only an
  opaque session id in an HTTP-only cookie, and later uses `acquire_user_assertion()` to return the
  blueprint-scoped access token for the signed-in user.

## Notes on the dependencies

**`mcp` is pinned below 2.0.** `langchain-mcp-adapters` 0.3.1 declares `mcp>=1.24.0` with no upper
bound, but the MCP Python SDK 2.0 removed `mcp.shared.context.RequestContext`, which the adapters
import. Without the pin, a fresh resolve picks up `mcp` 2.x and the app fails at import. Drop the
pin once the adapters support 2.x.

**Windows on ARM.** `tiktoken`, pulled in by `langchain-openai`, publishes no `win_arm64` wheel at
any version, so on an ARM64 machine `uv sync` tries to build it from source and stops at
`can't find Rust compiler`. Create the virtual environment from an **x64** interpreter instead,
it runs fine under emulation for an I/O bound agent:

```powershell
uv venv --clear --python C:\Python312-x64\python.exe
uv sync
```

This is not needed on x64 Windows, macOS or Linux.

## Next step

This starting point is still free of Agent 365 instrumentation. The web app sign-in hook is in place
for the user OBO path, ready for the moment the runbook has created the blueprint and the Entra app
registration. We can run the sample anonymously at first, then turn on sign-in by filling in the
Entra settings without changing the code.

➡️ **[Go to the runbook](../../../3.Runbook.md)**

To compare against the finished, fully instrumented version, see
[`python-agent-no-teams`](https://github.com/qmatteoq/agent365-demos/tree/main/python-agent-no-teams)
in the reference repo.
