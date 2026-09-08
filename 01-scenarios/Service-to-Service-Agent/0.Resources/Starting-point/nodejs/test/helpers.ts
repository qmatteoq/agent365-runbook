import { once } from "node:events";
import { request as httpRequest, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import type { TestContext } from "node:test";
import { createApp, type AppDependencies } from "../src/app.js";
import { readSettings, type Settings } from "../src/config.js";
import { Logger, type LogFields } from "../src/logging.js";
import { createLocalToken } from "../src/security.js";
import { SignJWT, type JWTPayload } from "jose";

export const TENANT = "11111111-1111-4111-8111-111111111111";
export const AUDIENCE = "22222222-2222-4222-8222-222222222222";
export const CALLER = "33333333-3333-4333-8333-333333333333";
export const OTHER = "44444444-4444-4444-8444-444444444444";
export const event = { sourceEventId: "smoke-1", orderId: "ORDER-1", delayHours: 12 };

export function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return {
        APP_ENVIRONMENT: "Development", INGRESS_MODE: "Local",
        INGRESS_TENANT_ID: TENANT, INGRESS_AUDIENCE: AUDIENCE,
        INGRESS_ALLOWED_CALLERS: JSON.stringify({ [CALLER]: "Local SAP middleware" }),
        INGRESS_LOCAL_SIGNING_KEY: randomBytes(48).toString("base64"), ...overrides,
    };
}

export async function start(t: TestContext, dependencies: AppDependencies = {}, settings = readSettings(environment())) {
    const logs: LogFields[] = [];
    const logger = new Logger((record) => logs.push(record));
    const app = createApp(settings, { logger, ...dependencies });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    closeAfter(t, server);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test address.");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const token = settings.ingress.mode === "Local" ? await createLocalToken(settings) : "";
    return { app, server, baseUrl, token, settings, logs };
}

export function closeAfter(t: TestContext, server: Server): void {
    t.after(() => new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
    }));
}

export async function send(baseUrl: string, token: string, body: unknown = event, correlation?: string) {
    const response = await fetch(`${baseUrl}/api/shipments`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(correlation === undefined ? {} : { "X-Correlation-ID": correlation }),
        },
        body: JSON.stringify(body),
    });
    return { status: response.status, headers: response.headers, body: await response.json() as any };
}

export function raw(baseUrl: string, headers: Record<string, string | string[]>, chunks: string[]) {
    return new Promise<{ status: number; headers: import("node:http").IncomingHttpHeaders; body: any }>((resolve, reject) => {
        const request = httpRequest(`${baseUrl}/api/shipments`, { method: "POST", headers }, (response) => {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", (chunk) => { body += chunk; });
            response.on("error", reject);
            response.on("end", () => {
                try { resolve({ status: response.statusCode!, headers: response.headers, body: JSON.parse(body) }); }
                catch (error) { reject(error); }
            });
        });
        request.on("error", reject);
        for (const chunk of chunks) request.write(chunk);
        request.end();
    });
}

export async function tokenWith(settings: Settings, changes: JWTPayload = {}, remove: string[] = [], key?: string, alg = "HS256") {
    const payload: JWTPayload = {
        iss: settings.ingress.issuer, aud: settings.ingress.audience, tid: settings.ingress.tenantId,
        azp: CALLER, idtyp: "app", roles: ["Shipment.Invoke"],
        nbf: Math.floor(Date.now() / 1000) - 5, exp: Math.floor(Date.now() / 1000) + 1800, ...changes,
    };
    for (const name of remove) delete payload[name];
    return new SignJWT(payload).setProtectedHeader({ alg }).sign(new TextEncoder().encode(key ?? settings.ingress.localSigningKey));
}
