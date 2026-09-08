from dataclasses import dataclass
from typing import Protocol

from app.models import RunContext, ShipmentEvent


@dataclass(frozen=True)
class OrderDetails:
    order_id: str
    sku: str
    quantity: int
    destination: str


@dataclass(frozen=True)
class InventoryDetails:
    sku: str
    available_units: int
    warehouse: str


class OrderReader(Protocol):
    async def read(self, order_id: str, run: RunContext) -> OrderDetails: ...


class InventoryReader(Protocol):
    async def read(self, sku: str, run: RunContext) -> InventoryDetails: ...


class ChannelNotifier(Protocol):
    async def notify(self, shipment: ShipmentEvent, summary: str, run: RunContext) -> str: ...


class TicketWriter(Protocol):
    async def create(self, shipment: ShipmentEvent, summary: str, run: RunContext) -> str: ...


class StubOrderReader:
    async def read(self, order_id: str, run: RunContext) -> OrderDetails:
        return OrderDetails(order_id, "WIDGET-42", 20, "Milan")


class StubInventoryReader:
    async def read(self, sku: str, run: RunContext) -> InventoryDetails:
        return InventoryDetails(sku, 50, "Bergamo")


class StubChannelNotifier:
    async def notify(self, shipment: ShipmentEvent, summary: str, run: RunContext) -> str:
        return f"stub-notification-{run.run_id}"


class StubTicketWriter:
    async def create(self, shipment: ShipmentEvent, summary: str, run: RunContext) -> str:
        return f"stub-ticket-{run.run_id}"
