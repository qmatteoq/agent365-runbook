import re
from dataclasses import asdict, dataclass
from threading import Lock


class InvalidEvent(ValueError):
    pass


@dataclass(frozen=True)
class ShipmentEvent:
    source_event_id: str
    order_id: str
    delay_hours: int

    @classmethod
    def from_json(cls, body: object) -> "ShipmentEvent":
        if not isinstance(body, dict):
            raise ValueError("The body must be an object.")
        values = {key.lower(): value for key, value in body.items()}
        source = values.get("sourceeventid")
        order = values.get("orderid")
        delay = values.get("delayhours", 0)
        if (
            any(value is not None and not isinstance(value, str) for value in (source, order))
            or type(delay) is not int or not -(2 ** 31) <= delay < 2 ** 31
        ):
            raise ValueError("The body has incorrect field types.")
        if (
            any(not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,100}", value) for value in (source, order))
            or not 1 <= delay <= 720
        ):
            raise InvalidEvent("Invalid shipment event.")
        return cls(source, order, delay)


@dataclass(frozen=True)
class RunContext:
    run_id: str
    correlation_id: str
    caller_client_id: str
    caller_display_name: str


@dataclass(frozen=True)
class RunResult:
    run_id: str
    correlation_id: str
    source_event_id: str
    reasoning_mode: str
    summary: str
    notification_id: str
    ticket_id: str


def camel_json(value: object) -> dict[str, object]:
    def camel(name: str) -> str:
        first, *rest = name.split("_")
        return first + "".join(part.capitalize() for part in rest)
    return {camel(key): field for key, field in asdict(value).items()}


@dataclass(frozen=True)
class Reservation:
    state: str
    result: RunResult | None = None


@dataclass(frozen=True)
class _Entry:
    shipment: ShipmentEvent
    reservation: Reservation


class EventLedger:
    def __init__(self, capacity: int = 10000) -> None:
        if type(capacity) is not int or capacity < 1:
            raise ValueError("AGENT_MAX_REMEMBERED_EVENTS must be positive.")
        self.capacity = capacity
        self._entries: dict[tuple[str, str], _Entry] = {}
        self._gate = Lock()

    def reserve(self, caller: str, shipment: ShipmentEvent) -> Reservation:
        with self._gate:
            key = (caller, shipment.source_event_id)
            existing = self._entries.get(key)
            if existing is not None:
                return Reservation("payload_conflict") if existing.shipment != shipment else existing.reservation
            if len(self._entries) >= self.capacity:
                return Reservation("capacity_reached")
            self._entries[key] = _Entry(shipment, Reservation("in_progress"))
            return Reservation("reserved")

    def finish(self, caller: str, shipment: ShipmentEvent, result: RunResult | None) -> None:
        with self._gate:
            self._entries[(caller, shipment.source_event_id)] = _Entry(
                shipment, Reservation("failed" if result is None else "completed", result)
            )
