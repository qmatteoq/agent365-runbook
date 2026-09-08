import { Logger } from "./logging.js";
import type { IExceptionReasoner } from "./reasoner.js";
import type { IChannelNotifier, IInventoryReader, IOrderReader, ITicketWriter } from "./tools.js";
import type { RunContext, RunResult, ShipmentEvent } from "./types.js";

export class ShipmentWorkflow {
    constructor(
        private readonly orders: IOrderReader,
        private readonly inventory: IInventoryReader,
        private readonly notifier: IChannelNotifier,
        private readonly tickets: ITicketWriter,
        private readonly reasoner: IExceptionReasoner,
        private readonly logger: Logger,
    ) {}

    async run(shipment: ShipmentEvent, run: RunContext, signal: AbortSignal): Promise<RunResult> {
        const started = performance.now();
        let outcome = "failed";
        this.logger.event("run.started", { ReasoningMode: this.reasoner.mode });
        try {
            const order = await this.executeTool("erp", "read_order", "one_order",
                () => this.orders.read(shipment.orderId, run, signal));
            const stock = await this.executeTool("inventory", "check_stock", "one_sku",
                () => this.inventory.read(order.sku, run, signal));
            const summary = await this.reasoner.summarize(shipment, order, stock, signal);
            if (!summary.trim()) throw new Error("The reasoner returned an empty operations summary.");
            const notificationId = await this.executeTool("channel", "notify_operations", "one_channel",
                () => this.notifier.notify(shipment, summary, run, signal));
            const ticketId = await this.executeTool("itsm", "create_ticket", "one_queue",
                () => this.tickets.create(shipment, summary, run, signal));
            outcome = "succeeded";
            return {
                runId: run.runId, correlationId: run.correlationId, sourceEventId: shipment.sourceEventId,
                reasoningMode: this.reasoner.mode, summary, notificationId, ticketId,
            };
        } finally {
            this.logger.event("run.ended", { Outcome: outcome, DurationMs: performance.now() - started });
        }
    }

    private async executeTool<T>(target: string, operation: string, dataScope: string, execute: () => Promise<T>): Promise<T> {
        const started = performance.now();
        let outcome = "failed";
        try {
            const result = await execute();
            outcome = "succeeded";
            return result;
        } finally {
            this.logger.event("tool.ended", {
                TargetSystem: target, Operation: operation, DataScope: dataScope, PermissionMode: "none",
                ToolMode: "Stub", Outcome: outcome, DurationMs: performance.now() - started,
            });
        }
    }
}
