export interface ShipmentEvent {
    sourceEventId: string;
    orderId: string;
    delayHours: number;
}

export interface RunContext {
    runId: string;
    correlationId: string;
    callerClientId: string;
    callerDisplayName: string;
}

export interface RunResult {
    runId: string;
    correlationId: string;
    sourceEventId: string;
    reasoningMode: string;
    summary: string;
    notificationId: string;
    ticketId: string;
}

export interface OrderDetails {
    orderId: string;
    sku: string;
    quantity: number;
    destination: string;
}

export interface InventoryDetails {
    sku: string;
    availableUnits: number;
    warehouse: string;
}

export function validateShipment(body: unknown): "invalid_request" | "invalid_event" | undefined {
    if (!body || typeof body !== "object" || Array.isArray(body)) return "invalid_request";
    const value = body as Record<string, unknown>;
    if ((value.sourceEventId != null && typeof value.sourceEventId !== "string") ||
        (value.orderId != null && typeof value.orderId !== "string") ||
        (value.delayHours !== undefined && (typeof value.delayHours !== "number" || !Number.isInteger(value.delayHours)))) {
        return "invalid_request";
    }
    if (!isIdentifier(value.sourceEventId) || !isIdentifier(value.orderId) ||
        typeof value.delayHours !== "number" || value.delayHours < 1 || value.delayHours > 720) {
        return "invalid_event";
    }
    return undefined;
}

function isIdentifier(value: unknown): boolean {
    return typeof value === "string" && value.length > 0 && value.length <= 100 && !/[^A-Za-z0-9_.:-]/.test(value);
}
