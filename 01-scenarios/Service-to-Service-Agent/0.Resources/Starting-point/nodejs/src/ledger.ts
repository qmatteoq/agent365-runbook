import type { RunResult, ShipmentEvent } from "./types.js";

interface Entry {
    event: ShipmentEvent;
    state: "in_progress" | "completed" | "failed";
    result?: RunResult;
}

export interface Reservation {
    state: Entry["state"] | "payload_conflict" | "capacity_reached" | "reserved";
    result?: RunResult;
}

export class EventLedger {
    private readonly entries = new Map<string, Entry>();

    constructor(private readonly capacity: number) {
        if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error("Event ledger capacity must be positive.");
    }

    reserve(caller: string, shipment: ShipmentEvent): Reservation {
        const key = JSON.stringify([caller, shipment.sourceEventId]);
        const existing = this.entries.get(key);
        if (existing) {
            if (existing.event.orderId !== shipment.orderId || existing.event.delayHours !== shipment.delayHours) {
                return { state: "payload_conflict" };
            }
            return { state: existing.state, result: existing.result };
        }
        if (this.entries.size >= this.capacity) return { state: "capacity_reached" };
        // Reserve before the first await so two requests cannot start the same event.
        this.entries.set(key, { event: { ...shipment }, state: "in_progress" });
        return { state: "reserved" };
    }

    finish(caller: string, shipment: ShipmentEvent, result?: RunResult): void {
        this.entries.set(JSON.stringify([caller, shipment.sourceEventId]), {
            event: { ...shipment },
            state: result ? "completed" : "failed",
            result,
        });
    }
}
