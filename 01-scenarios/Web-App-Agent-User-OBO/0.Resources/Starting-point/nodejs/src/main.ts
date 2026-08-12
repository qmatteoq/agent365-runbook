/** Express host for the Microsoft Learn agent. */

import { fileURLToPath } from "node:url";
import path from "node:path";

import express from "express";

import { LearnAgent } from "./agent.js";
import { settings } from "./config.js";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

const agent = new LearnAgent(settings);

const app = express();
app.use(express.json());
app.use("/static", express.static(PUBLIC_DIR));

app.get("/", (_req, res) => {
    // The file is resolved relative to `root` so that a dot-prefixed folder anywhere in the
    // absolute path - C:\Users\you\.something\ - isn't treated as a hidden file and 404'd.
    res.sendFile("index.html", { root: PUBLIC_DIR });
});

app.get("/api/info", (_req, res) => {
    res.json({
        deployment: settings.azureOpenAiDeployment,
        learnMcpEndpoint: settings.learnMcpEndpoint,
        tools: agent.toolNames,
    });
});

app.post("/api/chat", async (req, res) => {
    const { session_id: sessionId, message } = req.body ?? {};

    if (typeof sessionId !== "string" || !sessionId || typeof message !== "string" || !message) {
        res.status(400).json({ reply: "Both session_id and message are required." });
        return;
    }

    try {
        const reply = await agent.ask(sessionId, message);
        res.json({ reply });
    } catch (error) {
        console.error("Chat turn failed", error);
        res.json({ reply: "Sorry, something went wrong while researching that. Please try again." });
    }
});

// Connect to the Microsoft Learn MCP server and discover its tools once at startup,
// so every chat turn reuses the same tool list.
await agent.start();

app.listen(settings.port, settings.host, () => {
    console.info(`Listening on http://${settings.host}:${settings.port}`);
});
