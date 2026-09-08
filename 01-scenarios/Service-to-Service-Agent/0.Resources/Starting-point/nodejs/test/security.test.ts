import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { readSettings } from "../src/config.js";
import { createAuthenticator, isLoopback } from "../src/security.js";
import { CALLER, OTHER, environment, event, raw, send, start, tokenWith } from "./helpers.js";

test("JWT and app-only failures use the same statuses and reasons as .NET", async (t) => {
    const host = await start(t);
    const cases: [string, string, number, string][] = [
        ["missing", "", 401, "missing_token"],
        ["malformed", "not-a-jwt", 401, "invalid_token"],
        ["signature", await tokenWith(host.settings, {}, [], "x".repeat(48)), 401, "invalid_token"],
        ["audience", await tokenWith(host.settings, { aud: "other-api" }), 401, "invalid_token"],
        ["issuer", await tokenWith(host.settings, { iss: "https://untrusted.example" }), 401, "invalid_token"],
        ["expired", await tokenWith(host.settings, { exp: 1, nbf: 1 }), 401, "invalid_token"],
        ["future", await tokenWith(host.settings, { nbf: Math.floor(Date.now() / 1000) + 3600 }), 401, "invalid_token"],
        ["no expiration", await tokenWith(host.settings, {}, ["exp"]), 401, "invalid_token"],
        ["algorithm", await tokenWith(host.settings, {}, [], undefined, "HS384"), 401, "invalid_token"],
        ["tenant", await tokenWith(host.settings, { tid: OTHER }), 403, "wrong_tenant"],
        ["allowlist", await tokenWith(host.settings, { azp: OTHER }), 403, "caller_not_allowed"],
        ["caller missing", await tokenWith(host.settings, {}, ["azp"]), 403, "caller_not_allowed"],
        ["role missing", await tokenWith(host.settings, {}, ["roles"]), 403, "missing_role"],
        ["role wrong", await tokenWith(host.settings, { roles: ["shipment.invoke"] }), 403, "missing_role"],
        ["user idtyp", await tokenWith(host.settings, { idtyp: "user" }), 403, "app_only_required"],
        ["idtyp missing", await tokenWith(host.settings, {}, ["idtyp"]), 403, "app_only_required"],
    ];
    for (const claim of ["scp", "upn", "preferred_username", "unique_name"]) {
        cases.push([claim, await tokenWith(host.settings, { [claim]: "" }), 403, "app_only_required"]);
    }
    for (const [name, token, status, reason] of cases) {
        await t.test(name, async () => {
            const response = await send(host.baseUrl, token);
            assert.equal(response.status, status);
            assert.equal(response.body.error, reason);
            assert.equal(response.headers.get("x-correlation-id"), response.body.correlationId);
            if (status === 401) assert.equal(response.headers.get("www-authenticate"), "Bearer");
            const rejection = host.logs.at(-1)!;
            assert.equal(rejection.EventName, "ingress.rejected");
            assert.equal(rejection.Reason, reason);
            assert.ok(rejection.CallerClientId);
            if (status === 401) assert.equal(rejection.CallerClientId, "unknown");
        });
    }
    assert.equal(host.logs.filter((log) => log.EventName === "run.started").length, 0);
});

test("valid appid fallback, string roles and clock skew work, caller id is normalized", async (t) => {
    const host = await start(t);
    const token = await tokenWith(host.settings, {
        appid: `{${CALLER}}`, roles: "Shipment.Invoke", exp: Math.floor(Date.now() / 1000) - 10,
    }, ["azp"]);
    assert.equal((await send(host.baseUrl, token)).status, 200);
    assert.equal(host.logs.find((log) => log.EventName === "run.started")!.CallerClientId, CALLER);
    const expired = await tokenWith(host.settings, { exp: Math.floor(Date.now() / 1000) - 60 });
    assert.equal((await send(host.baseUrl, expired)).status, 401);
    const authenticate = createAuthenticator(host.settings.ingress);
    assert.equal((await authenticate(["Basic credentials"])).failure, "missing_token");
    assert.equal((await authenticate(["Bearer "])).failure, "missing_token");
    assert.ok((await authenticate([`Bearer   ${host.token} `])).claims);
});

test("correlation and authorization reject multiple headers before dispatch", async (t) => {
    const host = await start(t);
    for (const correlation of ["a".repeat(65), "bad value", "a,b", "bad:colon", ""]) {
        const response = await raw(host.baseUrl, {
            Authorization: `Bearer ${host.token}`, "Content-Type": "application/json", "X-Correlation-ID": correlation,
        }, [JSON.stringify(event)]);
        assert.equal(response.status, 400);
        assert.equal(response.body.error, "invalid_correlation_id");
        assert.equal(host.logs.at(-1)!.CallerClientId, CALLER);
    }
    const duplicate = await raw(host.baseUrl, {
        Authorization: `Bearer ${host.token}`, "Content-Type": "application/json", "X-Correlation-ID": ["one", "two"],
    }, [JSON.stringify(event)]);
    assert.equal(duplicate.body.error, "invalid_correlation_id");
    assert.notEqual(duplicate.headers["x-correlation-id"], "one");
    const duplicateAuth = await raw(host.baseUrl, {
        Authorization: [`Bearer ${host.token}`, `Bearer ${host.token}`], "Content-Type": "application/json",
    }, [JSON.stringify(event)]);
    assert.equal(duplicateAuth.status, 401);
    assert.equal(duplicateAuth.body.error, "invalid_token");
    assert.equal((await send(host.baseUrl, host.token, event, "a".repeat(64))).status, 200);
});

test("health needs no token and forwarded headers cannot change the transport address", async (t) => {
    const host = await start(t);
    assert.equal(host.app.get("trust proxy"), false);
    const health = await fetch(`${host.baseUrl}/health`);
    assert.deepEqual(await health.json(), { status: "ok" });
    assert.ok(health.headers.get("x-correlation-id"));
    for (const address of ["127.0.0.1", "127.20.30.40", "::1", "::ffff:127.0.0.1"]) assert.ok(isLoopback(address));
    for (const address of [undefined, "10.0.0.1", "localhost", "127.fake", "::ffff:10.0.0.1"]) assert.ok(!isLoopback(address));
    host.server.on("connection", (socket) => {
        Object.defineProperty(socket, "remoteAddress", { value: "10.0.0.1" });
    });
    const response = await raw(host.baseUrl, {
        Authorization: `Bearer ${host.token}`, "Content-Type": "application/json",
        "X-Forwarded-For": "127.0.0.1", Connection: "close",
    }, [JSON.stringify(event)]);
    assert.equal(response.status, 403);
    assert.equal(response.body.error, "local_requires_loopback");
    assert.equal(host.logs.at(-1)!.CallerClientId, "unknown");
});

test("Entra RS256 validation uses tenant issuer, audience and JWKS without a network dependency", async (t) => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = { ...await exportJWK(publicKey), kid: "entra-test", use: "sig", alg: "RS256" };
    const settings = readSettings(environment({ APP_ENVIRONMENT: "Production", INGRESS_MODE: "Entra" }));
    const host = await start(t, { entraKeys: createLocalJWKSet({ keys: [jwk] }) }, settings);
    async function token(changes = {}, kid = "entra-test") {
        return new SignJWT({
            iss: settings.ingress.issuer, aud: settings.ingress.audience, tid: settings.ingress.tenantId,
            azp: CALLER, idtyp: "app", roles: ["Shipment.Invoke"], exp: Math.floor(Date.now() / 1000) + 300,
            ...changes,
        }).setProtectedHeader({ alg: "RS256", kid }).sign(privateKey);
    }
    assert.equal((await send(host.baseUrl, await token())).status, 200);
    for (const invalid of [
        await token({ iss: `https://sts.windows.net/${settings.ingress.tenantId}/` }),
        await token({ aud: OTHER }), await token({}, "unknown-key"),
    ]) assert.equal((await send(host.baseUrl, invalid)).status, 401);
    const forged = await tokenWith({ ...settings, ingress: { ...settings.ingress, localSigningKey: "x".repeat(48) } });
    assert.equal((await send(host.baseUrl, forged)).status, 401);
    const verify = createAuthenticator(settings.ingress, createLocalJWKSet({ keys: [jwk] }));
    assert.ok((await verify([`Bearer ${await token()}`])).claims);
});
