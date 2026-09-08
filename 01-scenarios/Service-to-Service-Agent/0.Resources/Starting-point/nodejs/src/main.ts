import { createApp } from "./app.js";
import { ConfigurationError, loadEnvironment, readSettings } from "./config.js";
import { Logger } from "./logging.js";

const logger = new Logger();
try {
    loadEnvironment();
    const settings = readSettings();
    const app = createApp(settings);
    const server = app.listen(settings.port, settings.host, () => {
        logger.event("host.started", {
            Host: settings.host, Port: settings.port, IdentityMode: settings.ingress.mode,
            ReasoningMode: settings.reasoningMode, ToolMode: "Stub",
        });
    });
    server.on("error", () => {
        logger.event("host.failed", { Reason: "listener_failed" }, "Error");
        process.exitCode = 1;
    });
    const shutdown = () => { server.close(); server.closeIdleConnections(); };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
} catch (error) {
    logger.event("host.failed", {
        Reason: error instanceof ConfigurationError ? error.message : "startup_failed",
    }, "Error");
    process.exitCode = 1;
}
