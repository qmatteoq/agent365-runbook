/**
 * Loads `.env` into `process.env`, and does nothing else.
 *
 * This file exists purely so that it can be imported *first*, before anything else, in
 * `src/main.ts`. The Microsoft 365 Agents SDK reads its connection settings out of the
 * environment while `@microsoft/agents-hosting` is being evaluated, not when the server is
 * started, so by the time any of our own code runs it is already too late to populate them.
 *
 * ES module imports are evaluated in the order they appear, so putting this import at the top
 * of `main.ts` is what makes the ordering work. Calling `dotenv.config()` in the body of
 * `main.ts` would not: the body runs after every import has been evaluated, and the SDK would
 * have taken its snapshot of an empty environment long before.
 *
 * The symptom when this goes wrong is quiet rather than loud. The server starts, logs
 * `for appId undefined`, and every message from Teams is rejected as unauthorized.
 */

import "dotenv/config";
