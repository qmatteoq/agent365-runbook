import time
from collections.abc import Awaitable, Callable
from typing import TypeVar

from app.logs import log_event
from app.models import RunContext, RunResult, ShipmentEvent
from app.reasoner import ExceptionReasoner
from app.tools import ChannelNotifier, InventoryReader, OrderReader, TicketWriter

T = TypeVar("T")


class ShipmentWorkflow:
    def __init__(
        self, orders: OrderReader, inventory: InventoryReader, notifier: ChannelNotifier,
        tickets: TicketWriter, reasoner: ExceptionReasoner,
    ) -> None:
        self.orders = orders
        self.inventory = inventory
        self.notifier = notifier
        self.tickets = tickets
        self.reasoner = reasoner

    async def run(self, shipment: ShipmentEvent, run: RunContext) -> RunResult:
        started = time.perf_counter()
        outcome = "failed"
        log_event("run.started", ReasoningMode=self.reasoner.mode)
        try:
            order = await self.execute_tool("erp", "read_order", "one_order", lambda: self.orders.read(shipment.order_id, run))
            stock = await self.execute_tool("inventory", "check_stock", "one_sku", lambda: self.inventory.read(order.sku, run))
            summary = await self.reasoner.summarize(shipment, order, stock)
            notification = await self.execute_tool(
                "channel", "notify_operations", "one_channel", lambda: self.notifier.notify(shipment, summary, run)
            )
            ticket = await self.execute_tool(
                "itsm", "create_ticket", "one_queue", lambda: self.tickets.create(shipment, summary, run)
            )
            outcome = "succeeded"
            return RunResult(run.run_id, run.correlation_id, shipment.source_event_id,
                             self.reasoner.mode, summary, notification, ticket)
        finally:
            log_event("run.ended", Outcome=outcome, DurationMs=(time.perf_counter() - started) * 1000)

    @staticmethod
    async def execute_tool(target: str, operation: str, data_scope: str, execute: Callable[[], Awaitable[T]]) -> T:
        started = time.perf_counter()
        outcome = "failed"
        try:
            result = await execute()
            outcome = "succeeded"
            return result
        finally:
            log_event(
                "tool.ended", TargetSystem=target, Operation=operation, DataScope=data_scope,
                PermissionMode="none", ToolMode="Stub", Outcome=outcome,
                DurationMs=(time.perf_counter() - started) * 1000,
            )
