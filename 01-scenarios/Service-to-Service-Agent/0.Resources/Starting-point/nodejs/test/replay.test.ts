import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { parseReplayArguments, replay } from "../src/replay.js";
import { closeAfter, environment, send, start } from "./helpers.js";

test("replay CLI bounds arguments and disallows unsafe bearer-token destinations", () => {
    assert.equal(parseReplayArguments([]).count, 400);
    for (const args of [
        ["--count", "0"], ["--count", "10001"], ["--count", "1.5"], ["--count"],
        ["--count", "2", "--count", "3"], ["--token", "secret"], ["--delay-ms", "60001"],
        ["--batch-id", "x".repeat(33)], ["--batch-id", "bad\n"],
        ...["http://example.com", "https://user:secret@example.com", "https://example.com/path",
            "https://example.com?query=1", "https://example.com/#part", "/relative", "ftp://localhost",
        ].map((url) => ["--base-url", url]),
    ]) assert.throws(() => parseReplayArguments(args));
    for (const url of ["https://example.com", "http://localhost:5168", "http://127.0.0.1:5168", "http://[::1]:5168"]) {
        assert.doesNotThrow(() => parseReplayArguments(["--base-url", url]));
    }
});

test("400 events followed by 400 replays execute exactly 400 runs and 1600 tools", async (t) => {
    const host = await start(t);
    const options = parseReplayArguments(["--count", "400", "--batch-id", "nightly-demo", "--base-url", host.baseUrl]);
    const first = await replay(options, host.token);
    assert.equal(first.NewRuns, 400);
    assert.equal(first.Replays, 0);
    assert.equal(first.Failed, 0);
    const duplicate = await replay(options, host.token);
    assert.equal(duplicate.NewRuns, 0);
    assert.equal(duplicate.Replays, 400);
    assert.equal(duplicate.Failed, 0);
    assert.equal(host.logs.filter((log) => log.EventName === "run.started").length, 400);
    assert.equal(host.logs.filter((log) => log.EventName === "tool.ended").length, 1600);
});

test("replay never follows redirects, reports failures and exits nonzero", async (t) => {
    let targetRequests = 0;
    const server = createServer((request, response) => {
        if (request.url === "/api/shipments") {
            response.writeHead(307, { Location: "/stolen-token" });
        } else {
            targetRequests++;
            response.writeHead(200);
        }
        response.end();
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    closeAfter(t, server);
    const address = server.address() as { port: number };
    const args = ["--count", "2", "--batch-id", "redirect", "--base-url", `http://127.0.0.1:${address.port}`];
    const warnings: string[] = [];
    const result = await replay(parseReplayArguments(args), "test-only", (message) => warnings.push(message));
    assert.equal(result.Failed, 2);
    assert.equal(targetRequests, 0);
    assert.equal(warnings.length, 2);
    const cli = await command("src/replay.ts", args, { S2S_CALLER_TOKEN: "test-only" });
    assert.equal(cli.code, 1);
    assert.equal(JSON.parse(cli.stdout).Failed, 2);
    assert.ok(!cli.stderr.includes("test-only"));
    assert.equal(targetRequests, 0);
});

test("token CLI prints only a one-hour JWT and never starts a server", async (t) => {
    const host = await start(t);
    const env = environment({ INGRESS_LOCAL_SIGNING_KEY: host.settings.ingress.localSigningKey });
    const cli = await command("src/token.ts", [], env);
    assert.equal(cli.code, 0);
    assert.equal(cli.stderr, "");
    assert.match(cli.stdout.trim(), /^[\w-]+\.[\w-]+\.[\w-]+$/);
    const payload = JSON.parse(Buffer.from(cli.stdout.trim().split(".")[1]!, "base64url").toString("utf8"));
    assert.ok(Math.abs(payload.exp - Date.now() / 1000 - 3600) < 10);
    assert.equal((await send(host.baseUrl, cli.stdout.trim())).status, 200);
    assert.equal((await command("src/token.ts", [], { ...env, APP_ENVIRONMENT: "Production" })).code, 1);
    assert.equal((await command("src/token.ts", [], { ...env, INGRESS_MODE: "Entra" })).code, 1);
});

function command(script: string, args: string[], env: NodeJS.ProcessEnv) {
    return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(process.execPath, ["--import", "tsx", script, ...args], { env: { ...process.env, ...env } });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => { stdout += chunk; });
        child.stderr.on("data", (chunk) => { stderr += chunk; });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
}
