import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { isLoopback } from "./security.js";

export interface ReplayOptions {
    baseUrl: string;
    count: number;
    batchId: string;
    delayMs: number;
}

export function parseReplayArguments(args: string[]): ReplayOptions {
    const raw: Record<string, string> = {
        "--base-url": "http://localhost:5168", "--count": "400",
        "--batch-id": randomUUID().replaceAll("-", ""), "--delay-ms": "0",
    };
    const seen = new Set<string>();
    for (let index = 0; index < args.length; index += 2) {
        const name = args[index]!;
        const value = args[index + 1];
        if (!Object.hasOwn(raw, name) || value === undefined || seen.has(name)) {
            throw new Error("Use --count, --batch-id, --base-url and --delay-ms once each, followed by a value.");
        }
        raw[name] = value;
        seen.add(name);
    }
    function integer(name: string, minimum: number, maximum: number): number {
        const text = raw[name]!;
        const value = Number(text);
        if (!text || /[^0-9]/.test(text) || !Number.isInteger(value) || value < minimum || value > maximum) {
            throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
        }
        return value;
    }
    let origin: URL;
    try { origin = new URL(raw["--base-url"]!); }
    catch { throw new Error("--base-url must be an absolute HTTPS origin or an HTTP loopback origin."); }
    const hostname = origin.hostname.replace(/^\[|\]$/g, "");
    if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/" ||
        (origin.protocol !== "https:" && !(origin.protocol === "http:" && (hostname === "localhost" || isLoopback(hostname))))) {
        throw new Error("--base-url must be an HTTPS origin or an HTTP loopback origin without credentials, path, query or fragment.");
    }
    const batchId = raw["--batch-id"]!;
    if (!batchId || batchId.length > 32 || /[^A-Za-z0-9_-]/.test(batchId)) {
        throw new Error("--batch-id must contain 1 to 32 ASCII letters, digits, underscores or hyphens.");
    }
    return { baseUrl: origin.origin, count: integer("--count", 1, 10000), batchId, delayMs: integer("--delay-ms", 0, 60000) };
}

export async function replay(options: ReplayOptions, token: string, warn: (message: string) => void = console.error) {
    if (!token.trim()) throw new Error("Set S2S_CALLER_TOKEN. Do not put bearer tokens on the command line.");
    const clock = performance.now();
    let newRuns = 0;
    let replays = 0;
    let failed = 0;
    for (let index = 1; index <= options.count; index++) {
        try {
            const response = await fetch(new URL("/api/shipments", options.baseUrl), {
                method: "POST",
                redirect: "manual",
                signal: AbortSignal.timeout(120000),
                headers: {
                    Authorization: `Bearer ${token.trim()}`, "Content-Type": "application/json",
                    "X-Correlation-ID": `${options.batchId}-${index}`,
                },
                body: JSON.stringify({
                    sourceEventId: `${options.batchId}-${index}`, orderId: `ORDER-${index}`, delayHours: 12,
                }),
            });
            if (!response.ok) {
                await response.body?.cancel();
                failed++;
                warn(`Event ${index} returned HTTP ${response.status}.`);
            } else {
                const body = await response.json() as { replayed?: unknown; result?: unknown };
                if (typeof body?.replayed !== "boolean" || !body.result) throw new Error("Invalid response.");
                if (body.replayed) replays++;
                else newRuns++;
            }
        } catch {
            failed++;
            warn(`Event ${index} failed to complete or returned an invalid response.`);
        }
        if (options.delayMs > 0) await delay(options.delayMs);
    }
    return {
        BatchId: options.batchId, Attempts: options.count, NewRuns: newRuns, Replays: replays, Failed: failed,
        DurationSeconds: Math.round((performance.now() - clock) / 10) / 100,
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const options = parseReplayArguments(process.argv.slice(2));
        const report = await replay(options, process.env.S2S_CALLER_TOKEN ?? "");
        console.log(JSON.stringify(report));
        if (report.Failed > 0) process.exitCode = 1;
    } catch (error) {
        console.error(error instanceof Error ? error.message : "Replay failed.");
        process.exitCode = 1;
    }
}
