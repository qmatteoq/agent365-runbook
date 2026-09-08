import { ConfigurationError, loadEnvironment, readSettings } from "./config.js";
import { createLocalToken } from "./security.js";

try {
    if (process.argv.length > 2) throw new ConfigurationError("The token command takes no arguments.");
    loadEnvironment();
    console.log(await createLocalToken(readSettings()));
} catch (error) {
    console.error(error instanceof ConfigurationError ? error.message : "Local token issuance failed.");
    process.exitCode = 1;
}
