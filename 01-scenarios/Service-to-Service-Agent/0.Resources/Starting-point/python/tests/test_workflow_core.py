import asyncio
import io
import json
import logging
import unittest
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.logs import JsonFormatter, log_event, log_scope, logger
from app.models import EventLedger, InvalidEvent, RunContext, RunResult, ShipmentEvent, camel_json
from app.reasoner import StubExceptionReasoner
from app.tools import StubChannelNotifier, StubInventoryReader, StubOrderReader, StubTicketWriter
from app.workflow import ShipmentWorkflow


class CoreTests(unittest.TestCase):
    def test_payload_validation_and_camel_case(self):
        shipment = ShipmentEvent.from_json({"sourceEventId": "e", "orderId": "o", "delayHours": 12})
        self.assertEqual(camel_json(shipment), {"sourceEventId": "e", "orderId": "o", "delayHours": 12})
        for value in (True, 12.0, "12", None):
            with self.assertRaises(ValueError):
                ShipmentEvent.from_json({"sourceEventId": "e", "orderId": "o", "delayHours": value})
        for value in ("", "a" * 101, "é", "with space"):
            with self.assertRaises(InvalidEvent):
                ShipmentEvent.from_json({"sourceEventId": value, "orderId": "o", "delayHours": 12})
        for delay in (1, 720):
            self.assertEqual(ShipmentEvent.from_json({"sourceEventId": "a-_.:9", "orderId": "o", "delayHours": delay}).delay_hours, delay)

    def test_completed_replay_conflict_and_capacity(self):
        ledger = EventLedger(1)
        event = ShipmentEvent("event", "order", 12)
        self.assertEqual(ledger.reserve("caller", event).state, "reserved")
        self.assertEqual(ledger.reserve("caller", event).state, "in_progress")
        result = RunResult("run", "correlation", "event", "Stub", "summary", "notification", "ticket")
        ledger.finish("caller", event, result)
        self.assertEqual(ledger.reserve("caller", event).result, result)
        self.assertEqual(ledger.reserve("caller", ShipmentEvent("event", "other", 12)).state, "payload_conflict")
        self.assertEqual(ledger.reserve("caller", ShipmentEvent("other", "order", 12)).state, "capacity_reached")

    def test_threaded_reservations_failed_retention_and_caller_isolation(self):
        ledger = EventLedger(2)
        event = ShipmentEvent("event", "order", 12)
        with ThreadPoolExecutor(max_workers=16) as pool:
            states = list(pool.map(lambda _: ledger.reserve("caller", event).state, range(200)))
        self.assertEqual(states.count("reserved"), 1)
        self.assertEqual(states.count("in_progress"), 199)
        ledger.finish("caller", event, None)
        self.assertEqual(ledger.reserve("caller", event).state, "failed")
        self.assertEqual(ledger.reserve("other", event).state, "reserved")
        self.assertEqual(ledger.reserve("third", event).state, "capacity_reached")

    def test_400_events_and_400_replays(self):
        ledger = EventLedger(400)
        results = []
        for number in range(400):
            event = ShipmentEvent(f"nightly-{number}", f"ORDER-{number}", 12)
            self.assertEqual(ledger.reserve("caller", event).state, "reserved")
            result = RunResult(f"run-{number}", f"correlation-{number}", event.source_event_id, "Stub", "summary", "n", "t")
            ledger.finish("caller", event, result)
            results.append((event, result))
        for event, result in results:
            replayed = ledger.reserve("caller", event)
            self.assertEqual(replayed.state, "completed")
            self.assertEqual(replayed.result, result)


class AsyncCoreTests(unittest.IsolatedAsyncioTestCase):
    async def test_host_workflow_sequence_and_failed_write_propagation(self):
        steps = []
        run = RunContext("run-id", "correlation", "caller", "Caller")
        event = ShipmentEvent("event", "ORDER-1", 12)
        order = await StubOrderReader().read(event.order_id, run)
        inventory = await StubInventoryReader().read(order.sku, run)
        async def record_step(name, result):
            steps.append(name)
            return result
        agent = ShipmentWorkflow(
            SimpleNamespace(read=AsyncMock(side_effect=lambda *args: None)),
            SimpleNamespace(read=AsyncMock()), SimpleNamespace(notify=AsyncMock()),
            SimpleNamespace(create=AsyncMock()), SimpleNamespace(mode="Stub", summarize=AsyncMock()),
        )
        async def read_order(*args): return await record_step("read_order", order)
        async def read_inventory(*args): return await record_step("check_stock", inventory)
        async def summarize(*args): return await record_step("reason", "Summary")
        async def notify(*args): return await record_step("notify_operations", "n")
        async def ticket(*args): return await record_step("create_ticket", "t")
        agent.orders.read.side_effect = read_order
        agent.inventory.read.side_effect = read_inventory
        agent.reasoner.summarize.side_effect = summarize
        agent.notifier.notify.side_effect = notify
        agent.tickets.create.side_effect = ticket
        result = await agent.run(event, run)
        self.assertEqual(steps, ["read_order", "check_stock", "reason", "notify_operations", "create_ticket"])
        self.assertEqual((result.notification_id, result.ticket_id), ("n", "t"))
        agent.tickets.create.side_effect = RuntimeError("ticket failed")
        with self.assertRaisesRegex(RuntimeError, "ticket failed"):
            await agent.run(event, run)

    async def test_stub_summary_matches_dotnet(self):
        run = RunContext("run-id", "correlation", "caller", "Caller")
        event = ShipmentEvent("event", "ORDER-1", 12)
        order = await StubOrderReader().read(event.order_id, run)
        inventory = await StubInventoryReader().read(order.sku, run)
        self.assertEqual(await StubExceptionReasoner().summarize(event, order, inventory),
                         "Local simulation: order ORDER-1 is delayed by 12 hours. "
                         "Bergamo has 50 units of WIDGET-42; the order needs 20. "
                         "Ask the operations team to assess an alternative shipment. No shipment has been changed.")

    async def test_stub_tools_use_same_data_and_result_ids(self):
        run = RunContext("run-id", "correlation", "caller", "Caller")
        shipment = ShipmentEvent("event", "ORDER-1", 12)
        order = await StubOrderReader().read(shipment.order_id, run)
        inventory = await StubInventoryReader().read(order.sku, run)
        self.assertEqual((order.sku, order.quantity, order.destination), ("WIDGET-42", 20, "Milan"))
        self.assertEqual((inventory.available_units, inventory.warehouse), (50, "Bergamo"))
        self.assertEqual(await StubChannelNotifier().notify(shipment, "summary", run), "stub-notification-run-id")
        self.assertEqual(await StubTicketWriter().create(shipment, "summary", run), "stub-ticket-run-id")

    async def test_context_crosses_task_boundary_without_leaking(self):
        output = io.StringIO()
        handler = logging.StreamHandler(output)
        handler.setFormatter(JsonFormatter())
        old_level = logger.level
        logger.setLevel(logging.INFO)
        logger.addHandler(handler)
        async def child():
            await asyncio.sleep(0)
            log_event("child")
        try:
            with log_scope(RunId="one", CallerClientId="first"):
                first = asyncio.create_task(child())
            with log_scope(RunId="two", CallerClientId="second"):
                second = asyncio.create_task(child())
            await asyncio.gather(first, second)
            log_event("outside")
        finally:
            logger.removeHandler(handler)
            logger.setLevel(old_level)
        records = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual([row.get("RunId") for row in records], ["one", "two", None])
        self.assertEqual([row.get("CallerClientId") for row in records], ["first", "second", None])
        self.assertTrue(all("Timestamp" in row for row in records))


if __name__ == "__main__":
    unittest.main()
