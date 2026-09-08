import { randomUUID } from "node:crypto";
import express, { type ErrorRequestHandler, type Response } from "express";
import type { JWTVerifyGetKey } from "jose";
import type { Settings } from "./config.js";
import { EventLedger } from "./ledger.js";
import { Logger, requestContext, type LogFields } from "./logging.js";
import { createModelReasoner, StubExceptionReasoner, type IExceptionReasoner } from "./reasoner.js";
import { authorizationFailure, callerId, createAuthenticator, headerValues, isLoopback } from "./security.js";
import {
    StubChannelNotifier, StubInventoryReader, StubOrderReader, StubTicketWriter,
    type IChannelNotifier, type IInventoryReader, type IOrderReader, type ITicketWriter,
} from "./tools.js";
import { validateShipment, type RunResult, type ShipmentEvent } from "./types.js";
import { ShipmentWorkflow } from "./workflow.js";

export interface AppDependencies {
    logger?: Logger;
    ledger?: EventLedger;
    reasoner?: IExceptionReasoner;
    orders?: IOrderReader;
    inventory?: IInventoryReader;
    notifier?: IChannelNotifier;
    tickets?: ITicketWriter;
    entraKeys?: JWTVerifyGetKey;
}

export function createApp(settings: Settings, dependencies: AppDependencies = {}) {
    const logger = dependencies.logger ?? new Logger();
    const ledger = dependencies.ledger ?? new EventLedger(settings.maxRememberedEvents);
    const reasoner = dependencies.reasoner ?? (settings.reasoningMode === "Stub"
        ? new StubExceptionReasoner() : createModelReasoner(settings.model!));
    const workflow = new ShipmentWorkflow(
        dependencies.orders ?? new StubOrderReader(),
        dependencies.inventory ?? new StubInventoryReader(),
        dependencies.notifier ?? new StubChannelNotifier(),
        dependencies.tickets ?? new StubTicketWriter(),
        reasoner, logger,
    );
    const authenticate = createAuthenticator(settings.ingress, dependencies.entraKeys);
    const app = express();
    app.disable("x-powered-by");
    app.set("trust proxy", false);

    function reject(response: Response, status: number, reason: string): void {
        logger.event("ingress.rejected", { Reason: reason, StatusCode: status }, "Warning");
        if (status === 401) response.setHeader("WWW-Authenticate", "Bearer");
        response.status(status).json({ error: reason, correlationId: response.locals.context.CorrelationId });
    }

    app.use((request, response, next) => {
        const supplied = headerValues(request.rawHeaders, "X-Correlation-ID");
        const value = supplied[0];
        const valid = supplied.length === 0 || (supplied.length === 1 && value !== undefined &&
            value.length > 0 && value.length <= 64 && !/[^A-Za-z0-9_.-]/.test(value));
        const context: LogFields = {
            CorrelationId: valid && value ? value : randomUUID(),
            CallerClientId: "unknown",
            CallerDisplayName: "unknown",
            IdentityMode: settings.ingress.mode,
        };
        response.locals.context = context;
        response.setHeader("X-Correlation-ID", context.CorrelationId as string);
        void requestContext.run(context, async () => {
            try {
                if (settings.ingress.mode === "Local" && !isLoopback(request.socket.remoteAddress)) {
                    reject(response, 403, "local_requires_loopback");
                    return;
                }
                // Authenticate first so malformed correlation IDs still have a verified caller in logs.
                const authentication = await authenticate(headerValues(request.rawHeaders, "Authorization"));
                response.locals.authentication = authentication;
                const caller = callerId(authentication.claims);
                context.CallerClientId = caller ?? "unknown";
                context.CallerDisplayName = caller ? settings.ingress.allowedCallers.get(caller) ?? "unknown" : "unknown";
                if (!valid) {
                    reject(response, 400, "invalid_correlation_id");
                    return;
                }
                next();
            } catch (error) {
                next(error);
            }
        });
    });

    app.get("/health", (_request, response) => response.json({ status: "ok" }));
    app.post("/api/shipments", (request, response, next) => {
        const authentication = response.locals.authentication;
        if (!authentication.claims) {
            reject(response, 401, authentication.failure ?? "missing_token");
            return;
        }
        const failure = authorizationFailure(authentication.claims, settings.ingress);
        if (failure) {
            reject(response, 403, failure);
            return;
        }
        if (!request.is(["application/json", "application/*+json"])) {
            reject(response, 415, "invalid_request");
            return;
        }
        next();
    }, express.json({ limit: 16 * 1024, strict: true, inflate: false, type: ["application/json", "application/*+json"] }),
    async (request, response) => requestContext.run(response.locals.context, async () => {
        const failure = validateShipment(request.body);
        if (failure) {
            if (failure === "invalid_event") logger.event("shipment.invalid", { Reason: failure }, "Warning");
            reject(response, 400, failure);
            return;
        }
        const shipment: ShipmentEvent = {
            sourceEventId: request.body.sourceEventId, orderId: request.body.orderId, delayHours: request.body.delayHours,
        };
        const caller = callerId(response.locals.authentication.claims)!;
        const context = response.locals.context as LogFields;
        context.SourceEventId = shipment.sourceEventId;
        const reservation = ledger.reserve(caller, shipment);
        if (reservation.state !== "reserved") {
            logger.event("ingress.replay", { Decision: reservation.state, OriginalRunId: reservation.result?.runId });
            if (reservation.state === "completed") response.json({ replayed: true, result: reservation.result });
            else reject(response, reservation.state === "capacity_reached" ? 503 : 409, reservation.state);
            return;
        }
        const run = {
            runId: randomUUID(), correlationId: context.CorrelationId as string, callerClientId: caller,
            callerDisplayName: settings.ingress.allowedCallers.get(caller)!,
        };
        context.RunId = run.runId;
        const controller = new AbortController();
        const onAbort = () => controller.abort();
        const onClose = () => { if (!response.writableEnded) controller.abort(); };
        request.once("aborted", onAbort);
        response.once("close", onClose);
        let result: RunResult | undefined;
        try {
            result = await workflow.run(shipment, run, controller.signal);
            response.json({ replayed: false, result });
        } finally {
            // A failed run may already have notified a downstream system.
            ledger.finish(caller, shipment, result);
            request.removeListener("aborted", onAbort);
            response.removeListener("close", onClose);
        }
    }));

    app.all("/api/shipments", (_request, response) => {
        response.setHeader("Allow", "POST");
        reject(response, 405, "invalid_request");
    });
    app.use((_request, response) => reject(response, 404, "not_found"));
    const errors: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
        requestContext.run(response.locals.context, () => {
            if (response.headersSent) {
                logger.event("ingress.rejected", { Reason: "run_failed", StatusCode: 500 }, "Error");
                response.destroy();
                return;
            }
            response.setHeader("X-Correlation-ID", response.locals.context.CorrelationId);
            const parserError = error && typeof error === "object" && "type" in error && "status" in error &&
                typeof error.type === "string" && ["entity.parse.failed", "entity.too.large", "charset.unsupported",
                    "encoding.unsupported", "request.aborted", "request.size.invalid"].includes(error.type);
            const status = parserError ? error.status : undefined;
            if (status === 400 || status === 413 || status === 415) reject(response, status, "invalid_request");
            else reject(response, 500, "run_failed");
        });
    };
    app.use(errors);
    return app;
}
