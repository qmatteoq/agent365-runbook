"""Host for the Microsoft Learn agent as an Agent 365 AI Teammate.

The hosting model here is identical to the Teams starting point: the Microsoft 365 Agents
SDK owns the channel, authenticates the incoming Bot Framework request, hands the turn to
:class:`AgentApplication`, and sends replies back through the connector. Same
``/api/messages``, same activity protocol, same ``CloudAdapter``.

What changes is who plays the part of the bot registration. There is no Azure Bot resource
in front of this agent. The Agent 365 blueprint holds the messaging endpoint instead, so
``a365 setup all --aiteammate --m365`` is what registers this endpoint with Teams.

Until that registration happens, the agent runs in anonymous mode and the Microsoft 365
Agents Playground talks to it directly over localhost. That is what makes it testable
before any onboarding exists.
"""

from __future__ import annotations

import logging
from os import environ, path

from aiohttp.web import Application, Request, Response, middleware, run_app
from dotenv import load_dotenv
from microsoft_agents.activity import load_configuration_from_env
from microsoft_agents.authentication.msal import MsalConnectionManager
from microsoft_agents.hosting.aiohttp import (
    CloudAdapter,
    jwt_authorization_middleware,
    start_agent_process,
)
from microsoft_agents.hosting.core import (
    AgentApplication,
    Authorization,
    MemoryStorage,
    TurnContext,
    TurnState,
)

load_dotenv(path.join(path.dirname(path.dirname(path.abspath(__file__))), ".env"))

from app.agent import LearnAgent  # noqa: E402  (must follow load_dotenv)
from app.config import settings  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("learn-teammate-agent")

WELCOME = (
    "Hi! I'm the **Microsoft Learn research agent**. Ask me anything about the Microsoft "
    "ecosystem - Azure, Microsoft 365, Power Platform, .NET, Entra, Copilot or Dynamics 365 - "
    "and I'll answer from the official Microsoft Learn documentation and cite my sources.\n\n"
    "Type `/reset` to start a fresh conversation."
)

# ── Agents SDK wiring ────────────────────────────────────────────────────────────────
# Configuration comes from the environment using the SDK's double-underscore convention.
# Before onboarding there are no real credentials to read, and the agent runs anonymously.
#
# The SERVICE_CONNECTION keys still have to exist in .env even while empty. Unlike the
# .NET SDK, which logs "No connections found in configuration" and carries on, the Python
# connection manager is built eagerly and raises "No service connection configuration
# provided." when SERVICE_CONNECTION is absent altogether.
agents_sdk_config = load_configuration_from_env(environ)

# Anonymous mode. Before onboarding there is no client id, so there is no audience to
# validate a token against and nothing has issued one yet. The .NET starting point expresses
# this as an empty "TokenValidation:Audiences" array. The Python SDK has its own switch for
# it, ANONYMOUS_ALLOWED, which is set in .env and read below purely so the agent can warn
# about it at startup.
ANONYMOUS = (
    agents_sdk_config.get("CONNECTIONS", {})
    .get("SERVICE_CONNECTION", {})
    .get("SETTINGS", {})
    .get("ANONYMOUS_ALLOWED", "")
    .strip()
    .lower()
    in ("true", "1", "yes")
)

STORAGE = MemoryStorage()
CONNECTION_MANAGER = MsalConnectionManager(**agents_sdk_config)
ADAPTER = CloudAdapter(connection_manager=CONNECTION_MANAGER)
AUTHORIZATION = Authorization(STORAGE, CONNECTION_MANAGER, **agents_sdk_config)

AGENT_APP = AgentApplication[TurnState](
    storage=STORAGE,
    adapter=ADAPTER,
    authorization=AUTHORIZATION,
    **agents_sdk_config,
)

LEARN_AGENT = LearnAgent(settings)


async def _welcome(context: TurnContext, _state: TurnState) -> None:
    await context.send_activity(WELCOME)


AGENT_APP.conversation_update("membersAdded")(_welcome)
AGENT_APP.message("/help")(_welcome)


@AGENT_APP.message("/reset")
async def on_reset(context: TurnContext, _state: TurnState) -> None:
    LEARN_AGENT.reset(context.activity.conversation.id)
    await context.send_activity("Done - I've forgotten our conversation so far.")


@AGENT_APP.activity("message")
async def on_message(context: TurnContext, _state: TurnState) -> None:
    question = (context.activity.text or "").strip()
    if not question:
        await context.send_activity("Ask me a question about the Microsoft ecosystem.")
        return

    try:
        answer = await LEARN_AGENT.ask(context.activity.conversation.id, question)
    except Exception:
        # A failed turn must not take the channel down: Teams would show a bare
        # "the bot failed to respond" with nothing actionable in it.
        logger.exception("The agent failed to answer.")
        await context.send_activity(
            "Sorry - something went wrong while researching that. Please try again."
        )
        return

    await context.send_activity(answer)


@AGENT_APP.activity("installationUpdate")
async def on_installation_update(_context: TurnContext, _state: TurnState) -> None:
    """Swallow install/uninstall notifications.

    Teams sends these when the app is added or removed. There is nothing to do -- the
    welcome message is driven by the membersAdded conversation update instead -- but
    without a route the SDK logs a warning on every install, which is noise in a demo.
    """
    return


@AGENT_APP.error
async def on_error(context: TurnContext, error: Exception) -> None:
    logger.error("Unhandled agent error: %s", error, exc_info=error)


# ── aiohttp host ─────────────────────────────────────────────────────────────────────
async def _messages(req: Request) -> Response:
    return await start_agent_process(req, req.app["agent_app"], req.app["adapter"])


async def _health(_: Request) -> Response:
    return Response(
        text=f"Microsoft Learn agent is running. MCP tools: {LEARN_AGENT.tool_names or 'not yet connected'}",
        content_type="text/plain",
    )


@middleware
async def _auth_for_messages_only(request: Request, handler):
    """Apply Bot Framework JWT validation to the messaging endpoint only.

    ``jwt_authorization_middleware`` rejects any request without an ``Authorization``
    header, so registering it application-wide (as the SDK sample does) would also put the
    health route behind auth and make it useless as a liveness probe.

    It has to stay in the path for ``/api/messages`` even while the agent is anonymous.
    The middleware is what attaches a ``claims_identity`` to the request, and the adapter
    reads that to decide whether the turn is anonymous. Skipping the middleware to "allow"
    unauthenticated calls therefore backfires: the turn is then treated as authenticated,
    the adapter tries to build a real user token client, and it fails with
    ``TENANT_ID is not set in the configuration``. Setting ``ANONYMOUS_ALLOWED`` in .env is
    the supported way to do this.
    """
    if request.path.startswith("/api/messages") and request.method == "POST":
        return await jwt_authorization_middleware(request, handler)
    return await handler(request)


def create_app() -> Application:
    app = Application(middlewares=[_auth_for_messages_only])
    app.router.add_post("/api/messages", _messages)
    # The Agents Playground and health probes issue a GET against the same route.
    app.router.add_get("/api/messages", lambda _: Response(status=200))
    app.router.add_get("/", _health)

    app["agent_configuration"] = CONNECTION_MANAGER.get_default_connection_configuration()
    app["agent_app"] = AGENT_APP
    app["adapter"] = ADAPTER
    return app


def main() -> None:
    if ANONYMOUS:
        logger.warning(
            "Running in anonymous mode: /api/messages is NOT authenticated. "
            "This is what lets the Agents Playground reach the agent before onboarding. "
            "Do not expose it on a public tunnel until 'a365 setup all --aiteammate --m365' "
            "has filled in the blueprint credentials."
        )
    logger.info("Starting the Microsoft Learn AI Teammate agent on port %d.", settings.port)
    run_app(create_app(), host="localhost", port=settings.port)


if __name__ == "__main__":
    main()
