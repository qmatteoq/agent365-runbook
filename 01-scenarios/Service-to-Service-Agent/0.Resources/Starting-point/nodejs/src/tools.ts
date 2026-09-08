import type { InventoryDetails, OrderDetails, RunContext, ShipmentEvent } from "./types.js";

export interface IOrderReader {
    read(orderId: string, run: RunContext, signal: AbortSignal): Promise<OrderDetails>;
}
export interface IInventoryReader {
    read(sku: string, run: RunContext, signal: AbortSignal): Promise<InventoryDetails>;
}
export interface IChannelNotifier {
    notify(shipment: ShipmentEvent, summary: string, run: RunContext, signal: AbortSignal): Promise<string>;
}
export interface ITicketWriter {
    create(shipment: ShipmentEvent, summary: string, run: RunContext, signal: AbortSignal): Promise<string>;
}

export class StubOrderReader implements IOrderReader {
    async read(orderId: string, _run: RunContext, signal: AbortSignal): Promise<OrderDetails> {
        signal.throwIfAborted();
        return { orderId, sku: "WIDGET-42", quantity: 20, destination: "Milan" };
    }
}

export class StubInventoryReader implements IInventoryReader {
    async read(sku: string, _run: RunContext, signal: AbortSignal): Promise<InventoryDetails> {
        signal.throwIfAborted();
        return { sku, availableUnits: 50, warehouse: "Bergamo" };
    }
}

export class StubChannelNotifier implements IChannelNotifier {
    async notify(_shipment: ShipmentEvent, _summary: string, run: RunContext, signal: AbortSignal): Promise<string> {
        signal.throwIfAborted();
        return `stub-notification-${run.runId}`;
    }
}

export class StubTicketWriter implements ITicketWriter {
    async create(_shipment: ShipmentEvent, _summary: string, run: RunContext, signal: AbortSignal): Promise<string> {
        signal.throwIfAborted();
        return `stub-ticket-${run.runId}`;
    }
}
