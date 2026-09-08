import { AsyncLocalStorage } from "node:async_hooks";

export type LogFields = Record<string, string | number | boolean | null | undefined>;
export type LogSink = (record: LogFields) => void;
export const requestContext = new AsyncLocalStorage<LogFields>();

export class Logger {
    constructor(private readonly sink: LogSink = (record) => console.log(JSON.stringify(record))) {}

    event(eventName: string, fields: LogFields = {}, level = "Information"): void {
        this.sink({
            Timestamp: new Date().toISOString(),
            LogLevel: level,
            ...requestContext.getStore(),
            ...fields,
            EventName: eventName,
        });
    }
}
