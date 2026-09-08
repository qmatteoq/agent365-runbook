from __future__ import annotations

import json
import logging
import re
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.auth import Authenticator, authorization_failure, caller_id, is_loopback
from app.config import Settings
from app.logs import log_event, log_scope
from app.models import EventLedger, InvalidEvent, RunContext, ShipmentEvent, camel_json
from app.reasoner import AzureOpenAIExceptionReasoner, StubExceptionReasoner
from app.tools import StubChannelNotifier, StubInventoryReader, StubOrderReader, StubTicketWriter
from app.workflow import ShipmentWorkflow

BODY_LIMIT = 16 * 1024


def reject(status: int, reason: str, correlation_id: str) -> JSONResponse:
    log_event("ingress.rejected", level=logging.WARNING, Reason=reason, StatusCode=status)
    return JSONResponse(
        {"error": reason, "correlationId": correlation_id}, status_code=status,
        headers={"WWW-Authenticate": "Bearer"} if status == 401 else None,
    )


class IngressMiddleware:
    def __init__(self, app: ASGIApp, settings: Settings, authenticator: Authenticator) -> None:
        self.app = app
        self.settings = settings
        self.authenticator = authenticator

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        supplied = headers.getlist("x-correlation-id")
        valid = not supplied or (len(supplied) == 1 and re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", supplied[0]) is not None)
        correlation = supplied[0] if supplied and valid else str(uuid4())
        scope.setdefault("state", {})["correlation_id"] = correlation
        response_started = False

        async def send_with_correlation(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)["X-Correlation-ID"] = correlation
                response_started = True
            await send(message)

        with log_scope(CorrelationId=correlation, CallerClientId="unknown", CallerDisplayName="unknown",
                       IdentityMode=self.settings.ingress_mode):
            remote = scope.get("client")
            if self.settings.is_local and not is_loopback(remote[0] if remote else None):
                await reject(403, "local_requires_loopback", correlation)(scope, receive, send_with_correlation)
                return
            claims, failure = await self.authenticator.authenticate(headers.getlist("authorization"))
            caller = caller_id(claims)
            scope["state"]["caller_id"] = caller
            with log_scope(CallerClientId=caller or "unknown",
                           CallerDisplayName=self.settings.ingress_allowed_callers.get(caller, "unknown")):
                response = None
                if not valid:
                    response = reject(400, "invalid_correlation_id", correlation)
                elif scope["path"] == "/api/shipments" and scope["method"] == "POST" and claims is None:
                    response = reject(401, failure, correlation)
                elif claims is not None and (
                    scope["path"] == "/api/shipments" or scope["path"].startswith("/api/shipments/")
                ):
                    policy_failure = authorization_failure(claims, self.settings)
                    if policy_failure is not None:
                        response = reject(403, policy_failure, correlation)
                if response is not None:
                    await response(scope, receive, send_with_correlation)
                    return
                try:
                    await self.app(scope, receive, send_with_correlation)
                except Exception as error:
                    log_event("request.failed", level=logging.ERROR, ErrorType=type(error).__name__, StatusCode=500)
                    if response_started:
                        raise
                    await JSONResponse(
                        {"error": "run_failed", "correlationId": correlation}, status_code=500
                    )(scope, receive, send_with_correlation)


def create_app(settings: Settings | None = None, workflow: ShipmentWorkflow | None = None) -> FastAPI:
    settings = settings or Settings()
    if workflow is None:
        reasoner = StubExceptionReasoner() if settings.agent_reasoning_mode == "Stub" else AzureOpenAIExceptionReasoner(settings)
        workflow = ShipmentWorkflow(StubOrderReader(), StubInventoryReader(), StubChannelNotifier(), StubTicketWriter(), reasoner)
    ledger = EventLedger(settings.agent_max_remembered_events)
    authenticator = Authenticator(settings)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, redirect_slashes=False)
    app.state.ledger = ledger
    app.state.workflow = workflow
    app.state.authenticator = authenticator
    app.add_middleware(IngressMiddleware, settings=settings, authenticator=authenticator)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/shipments")
    async def shipments(request: Request) -> JSONResponse:
        correlation = request.state.correlation_id
        media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if media_type != "application/json" and not (media_type.startswith("application/") and media_type.endswith("+json")):
            return reject(415, "invalid_request", correlation)
        declared = request.headers.get("content-length")
        if declared is not None:
            if not re.fullmatch(r"[0-9]+", declared):
                return reject(400, "invalid_request", correlation)
            normalized_length = declared.lstrip("0") or "0"
            if len(normalized_length) > 5 or int(normalized_length) > BODY_LIMIT:
                return reject(413, "invalid_request", correlation)
        data = bytearray()
        async for chunk in request.stream():
            if len(data) + len(chunk) > BODY_LIMIT:
                return reject(413, "invalid_request", correlation)
            data.extend(chunk)
        try:
            def invalid_constant(value: str) -> None:
                raise ValueError("Non-finite numbers are not JSON.")
            shipment = ShipmentEvent.from_json(json.loads(data, parse_constant=invalid_constant))
        except InvalidEvent:
            log_event("shipment.invalid", level=logging.WARNING, Reason="invalid_event")
            return JSONResponse({"error": "invalid_event", "correlationId": correlation}, status_code=400)
        except (ValueError, TypeError, RecursionError):
            return reject(400, "invalid_request", correlation)
        caller = request.state.caller_id
        with log_scope(SourceEventId=shipment.source_event_id):
            reservation = ledger.reserve(caller, shipment)
            if reservation.state != "reserved":
                log_event("ingress.replay", Decision=reservation.state,
                          OriginalRunId=reservation.result.run_id if reservation.result else None)
                if reservation.state == "completed":
                    return JSONResponse({"replayed": True, "result": camel_json(reservation.result)})
                return JSONResponse(
                    {"error": reservation.state, "correlationId": correlation},
                    status_code=503 if reservation.state == "capacity_reached" else 409,
                )
            run = RunContext(str(uuid4()), correlation, caller, settings.ingress_allowed_callers[caller])
            result = None
            with log_scope(RunId=run.run_id):
                try:
                    result = await workflow.run(shipment, run)
                    return JSONResponse({"replayed": False, "result": camel_json(result)})
                except Exception as error:
                    log_event("run.failed", level=logging.ERROR, ErrorType=type(error).__name__)
                    raise
                finally:
                    # A downstream write may have succeeded before the failure.
                    ledger.finish(caller, shipment, result)

    return app
