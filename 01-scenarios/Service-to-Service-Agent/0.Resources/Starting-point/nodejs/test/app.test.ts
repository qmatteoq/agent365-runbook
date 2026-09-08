import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { readSettings } from "../src/config.js";
import { EventLedger } from "../src/ledger.js";
import { requestContext } from "../src/logging.js";
import { StubExceptionReasoner } from "../src/reasoner.js";
import { StubChannelNotifier } from "../src/tools.js";
import { CALLER, OTHER, environment, event, raw, send, start } from "./helpers.js";

test("the host returns exact stub data, JSON casing and four ordered tool records", async (t) => {
    const host = await start(t);
    const response = await send(host.baseUrl, host.token, event, "supplied-correlation");
    assert.equal(response.status, 200);
    assert.equal(response.body.replayed, false);
    const result = response.body.result;
    assert.deepEqual(Object.keys(result).sort(), [
        "runId", "correlationId", "sourceEventId", "reasoningMode", "summary", "notificationId", "ticketId",
    ].sort());
    assert.equal(result.correlationId, "supplied-correlation");
    assert.equal(result.reasoningMode, "Stub");
    assert.equal(result.summary, "Local simulation: order ORDER-1 is delayed by 12 hours. " +
        "Bergamo has 50 units of WIDGET-42; the order needs 20. " +
        "Ask the operations team to assess an alternative shipment. No shipment has been changed.");
    assert.equal(result.notificationId, `stub-notification-${result.runId}`);
    assert.equal(result.ticketId, `stub-ticket-${result.runId}`);
    assert.deepEqual(host.logs.filter((log) => log.EventName === "tool.ended").map((log) => log.Operation),
        ["read_order", "check_stock", "notify_operations", "create_ticket"]);
    for (const record of host.logs) {
        assert.ok(!Number.isNaN(Date.parse(record.Timestamp as string)));
        assert.equal(record.CallerClientId, CALLER);
        assert.equal(record.CallerDisplayName, "Local SAP middleware");
        assert.equal(record.CorrelationId, "supplied-correlation");
        assert.equal(record.SourceEventId, event.sourceEventId);
        assert.equal(record.RunId, result.runId);
        if (typeof record.EventName === "string" && record.EventName.endsWith(".ended")) {
            assert.equal(record.Outcome, "succeeded");
            assert.ok((record.DurationMs as number) >= 0);
        }
        if (record.EventName === "tool.ended") {
            assert.equal(record.PermissionMode, "none");
            assert.equal(record.ToolMode, "Stub");
        }
    }
    const replay = await send(host.baseUrl, host.token, event, "current-attempt");
    assert.equal(replay.body.replayed, true);
    assert.deepEqual(replay.body.result, result);
    assert.equal(replay.headers.get("x-correlation-id"), "current-attempt");
    const conflict = await send(host.baseUrl, host.token, { ...event, orderId: "ORDER-2" });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error, "payload_conflict");
    assert.equal(host.logs.filter((log) => log.EventName === "run.started").length, 1);
});

test("JSON types, ASCII identifiers, integer bounds and chunked body limit", async (t) => {
    const host = await start(t);
    for (const body of [
        null, [], {}, { ...event, sourceEventId: 1 }, { ...event, sourceEventId: null },
        { ...event, orderId: [] }, { ...event, orderId: true }, { ...event, delayHours: "12" },
        { ...event, delayHours: 1.5 }, { ...event, delayHours: null }, { ...event, delayHours: true },
        { ...event, sourceEventId: "a\n" }, { ...event, sourceEventId: "é" },
        { ...event, orderId: "a/b" }, { ...event, orderId: "a".repeat(101) },
        { ...event, delayHours: 0 }, { ...event, delayHours: 721 },
    ]) {
        const response = await send(host.baseUrl, host.token, body);
        assert.equal(response.status, 400, JSON.stringify(body));
        assert.equal(response.headers.get("x-correlation-id"), response.body.correlationId);
        assert.equal(host.logs.at(-1)!.CallerClientId, CALLER);
    }
    const headers = { Authorization: `Bearer ${host.token}`, "Content-Type": "application/json" };
    for (const body of ["{", "", '"text"', "123"]) assert.equal((await raw(host.baseUrl, headers, [body])).status, 400);
    const type = await raw(host.baseUrl, { ...headers, "Content-Type": "text/plain" }, [JSON.stringify(event)]);
    assert.equal(type.status, 415);
    const oversized = JSON.stringify({ ...event, padding: "x".repeat(17000) });
    assert.equal((await raw(host.baseUrl, { ...headers, "Content-Length": String(Buffer.byteLength(oversized)) }, [oversized])).status, 413);
    assert.equal((await raw(host.baseUrl, headers, [oversized.slice(0, 8000), oversized.slice(8000)])).status, 413);
    assert.equal(host.logs.filter((log) => log.EventName === "run.started").length, 0);
    const exact = JSON.stringify({ ...event, sourceEventId: "boundary", padding: "" });
    const padded = exact.replace('"padding":""', `"padding":"${"x".repeat(16384 - Buffer.byteLength(exact))}"`);
    assert.equal(Buffer.byteLength(padded), 16384);
    assert.equal((await raw(host.baseUrl, headers, [padded])).status, 200);
    for (const delayHours of [1, 720]) {
        assert.equal((await send(host.baseUrl, host.token, {
            sourceEventId: `valid-${delayHours}`, orderId: "a-A_1.:".padEnd(100, "a"), delayHours,
        })).status, 200);
    }
});

test("authorization runs before malformed JSON parsing", async (t) => {
    const host = await start(t);
    const response = await raw(host.baseUrl, { "Content-Type": "application/json" }, ["{"]);
    assert.equal(response.status, 401);
    assert.equal(response.body.error, "missing_token");
});

test("synchronous reservation prevents concurrent runs and preserves async log context", async (t) => {
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const contexts: unknown[] = [];
    const host = await start(t, {
        reasoner: {
            mode: "Stub",
            async summarize(shipment, order, stock, signal) {
                entered();
                await gate;
                await delay(1);
                contexts.push({ ...requestContext.getStore() });
                return new StubExceptionReasoner().summarize(shipment, order, stock, signal);
            },
        },
    });
    const first = send(host.baseUrl, host.token, event, "concurrent-first");
    await ready;
    const duplicates = await Promise.all(Array.from({ length: 12 }, () => send(host.baseUrl, host.token)));
    assert.ok(duplicates.every((response) => response.status === 409 && response.body.error === "in_progress"));
    release();
    const completed = await first;
    assert.equal(completed.status, 200);
    assert.equal((contexts[0] as any).CorrelationId, "concurrent-first");
    assert.equal(host.logs.filter((log) => log.EventName === "run.started").length, 1);
    assert.equal((await send(host.baseUrl, host.token)).body.replayed, true);
});

test("failed writes are retained and 500 errors do not leak credentials or lose correlation", async (t) => {
    let notifications = 0;
    const host = await start(t, {
        notifier: {
            async notify(...args) {
                notifications++;
                return new StubChannelNotifier().notify(...args);
            },
        },
        tickets: { async create() { throw Object.assign(new Error("secret-do-not-log"), { status: 400 }); } },
    });
    const failed = await send(host.baseUrl, host.token, event, "failed-correlation");
    assert.equal(failed.status, 500);
    assert.deepEqual(failed.body, { error: "run_failed", correlationId: "failed-correlation" });
    assert.equal(failed.headers.get("x-correlation-id"), "failed-correlation");
    const retry = await send(host.baseUrl, host.token);
    assert.equal(retry.status, 409);
    assert.equal(retry.body.error, "failed");
    assert.equal(notifications, 1);
    const tools = host.logs.filter((log) => log.EventName === "tool.ended");
    assert.equal(tools.length, 4);
    assert.equal(tools.at(-1)!.Outcome, "failed");
    assert.equal(host.logs.find((log) => log.EventName === "run.ended")!.Outcome, "failed");
    assert.ok(!JSON.stringify(host.logs).includes("secret-do-not-log"));
    assert.ok(!JSON.stringify(host.logs).includes(host.token));
});

test("empty reasoning fails before notification and ticket tools", async (t) => {
    const host = await start(t, { reasoner: { mode: "AzureOpenAI", async summarize() { return " "; } } });
    assert.equal((await send(host.baseUrl, host.token)).status, 500);
    assert.equal((await send(host.baseUrl, host.token)).body.error, "failed");
    assert.equal(host.logs.filter((log) => log.EventName === "tool.ended").length, 2);
});

test("ledger capacity retains old entries, accepts completed replays and keys by caller", async (t) => {
    const settings = readSettings(environment({ AGENT_MAX_REMEMBERED_EVENTS: "1" }));
    const host = await start(t, {}, settings);
    assert.equal((await send(host.baseUrl, host.token)).status, 200);
    const rejected = await send(host.baseUrl, host.token, { ...event, sourceEventId: "new" });
    assert.equal(rejected.status, 503);
    assert.equal(rejected.body.error, "capacity_reached");
    assert.equal((await send(host.baseUrl, host.token)).body.replayed, true);
    const ledger = new EventLedger(2);
    assert.equal(ledger.reserve(CALLER, event).state, "reserved");
    assert.equal(ledger.reserve(OTHER, event).state, "reserved");
    ledger.finish(CALLER, event);
    assert.equal(ledger.reserve(CALLER, event).state, "failed");
    assert.equal(ledger.reserve(CALLER, { ...event, delayHours: 2 }).state, "payload_conflict");
    assert.equal(ledger.reserve(CALLER, { ...event, sourceEventId: "new" }).state, "capacity_reached");
});
