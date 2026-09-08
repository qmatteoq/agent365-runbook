import asyncio
import contextlib
import io
import json
import logging
import os
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

from app.auth import Authenticator, issue_local_token
from app.config import Settings
from app.logs import JsonFormatter, log_event, log_scope, logger
from app.main import BODY_LIMIT, create_app
from app.models import EventLedger, RunContext, ShipmentEvent
from app.reasoner import AzureOpenAIExceptionReasoner, StubExceptionReasoner, build_model
from app.replay import batch_id, bounded_integer, main as replay_main, origin, replay
from app.tools import StubChannelNotifier, StubInventoryReader, StubOrderReader, StubTicketWriter
from app.workflow import ShipmentWorkflow

TENANT = "11111111-1111-4111-8111-111111111111"
AUDIENCE = "22222222-2222-4222-8222-222222222222"
CALLER = "33333333-3333-4333-8333-333333333333"
OTHER = "44444444-4444-4444-8444-444444444444"
KEY = "test-only-" + "a" * 48
EVENT = {"sourceEventId": "smoke-1", "orderId": "ORDER-1", "delayHours": 12}


def settings(**changes) -> Settings:
    values = dict(
        app_environment="Development", ingress_mode="Local", ingress_tenant_id=TENANT,
        ingress_audience=AUDIENCE, ingress_allowed_callers={CALLER: "Local SAP middleware"},
        ingress_local_signing_key=KEY,
    )
    values.update(changes)
    with patch.dict(os.environ, {}, clear=True):
        return Settings(_env_file=None, **values)


def token(*, remove=(), key=KEY, algorithm="HS256", headers=None, **changes) -> str:
    claims = dict(iss="https://supply-chain.local", aud=AUDIENCE, tid=TENANT, azp=CALLER,
                  idtyp="app", roles=["Shipment.Invoke"], nbf=int(time.time()) - 5, exp=int(time.time()) + 1800)
    claims.update(changes)
    for name in remove:
        claims.pop(name, None)
    return jwt.encode(claims, key, algorithm=algorithm, headers=headers)


def workflow(reasoner=None, notifier=None, tickets=None) -> ShipmentWorkflow:
    return ShipmentWorkflow(StubOrderReader(), StubInventoryReader(), notifier or StubChannelNotifier(),
                            tickets or StubTicketWriter(), reasoner or StubExceptionReasoner())


class ConfigurationTests(unittest.TestCase):
    def test_fail_closed(self):
        with patch.dict(os.environ, {}, clear=True), self.assertRaises(ValueError):
            Settings(_env_file=None)
        with self.assertRaisesRegex(ValueError, "only in Development"):
            settings(app_environment="Production")
        with self.assertRaisesRegex(ValueError, "32 UTF-8 bytes"):
            settings(ingress_local_signing_key="é" * 15)
        self.assertTrue(settings(ingress_local_signing_key="é" * 16).is_local)
        for updates in [
            {"ingress_mode": "none"}, {"ingress_tenant_id": "bad"}, {"ingress_audience": "bad"},
            {"ingress_allowed_callers": {}}, {"ingress_allowed_callers": {CALLER: ""}},
            {"ingress_required_role": ""}, {"agent_reasoning_mode": "random"},
            {"agent_max_remembered_events": 0}, {"agent_max_remembered_events": True},
            {"agent_max_remembered_events": 1.0}, {"port": 65536},
        ]:
            with self.subTest(updates=updates), self.assertRaises(ValueError):
                settings(**updates)

    def test_guid_normalization(self):
        guid = "abcdefab-cdef-4abc-8def-abcdefabcdef"
        value = settings(ingress_allowed_callers={guid.upper(): "Caller"})
        self.assertEqual(value.ingress_allowed_callers, {guid: "Caller"})

    def test_environment_overrides_dotenv(self):
        with patch.dict(os.environ, {"PORT": "5170"}, clear=True):
            value = Settings(_env_file=".env.example", ingress_local_signing_key=KEY)
        self.assertEqual(value.port, 5170)
        self.assertEqual(value.app_environment, "Development")
        self.assertEqual(value.ingress_allowed_callers, {CALLER: "Local SAP middleware"})

    def test_local_token_command_prints_only_one_hour_token(self):
        from app.__main__ import main
        output = io.StringIO()
        with patch("app.__main__.Settings", return_value=settings()), patch("sys.argv", ["app", "--issue-local-token"]), contextlib.redirect_stdout(output):
            self.assertEqual(main(), 0)
        text = output.getvalue().strip()
        self.assertEqual(len(text.splitlines()), 1)
        claims = jwt.decode(text, KEY, algorithms=["HS256"], audience=AUDIENCE, issuer="https://supply-chain.local")
        self.assertAlmostEqual(claims["exp"] - time.time(), 3600, delta=2)
        self.assertEqual(claims["azp"], CALLER)
        with self.assertRaisesRegex(ValueError, "cannot be issued"):
            issue_local_token(settings(app_environment="Production", ingress_mode="Entra"))

    def test_cli_uses_one_worker_without_proxy_headers(self):
        from app.__main__ import main
        with patch("app.__main__.Settings", return_value=settings()), patch("sys.argv", ["app"]), \
             patch("uvicorn.run") as run, patch("app.logs.configure_logging"), patch("app.logs.log_event"):
            self.assertEqual(main(), 0)
        self.assertEqual(run.call_args.kwargs["workers"], 1)
        self.assertFalse(run.call_args.kwargs["proxy_headers"])
        self.assertEqual(run.call_args.kwargs["forwarded_allow_ips"], "")


class ApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.app = create_app(settings())
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app, client=("127.0.0.1", 12345)), base_url="http://localhost"
        )
        self.log_output = io.StringIO()
        self.handler = logging.StreamHandler(self.log_output)
        self.handler.setFormatter(JsonFormatter())
        self.old_level = logger.level
        logger.setLevel(logging.INFO)
        logger.addHandler(self.handler)

    async def asyncTearDown(self):
        await self.client.aclose()
        logger.removeHandler(self.handler)
        logger.setLevel(self.old_level)

    async def send(self, bearer=None, body=None, headers=None):
        request_headers = [("Authorization", "Bearer " + (bearer if bearer is not None else token()))]
        request_headers += headers or []
        return await self.client.post("/api/shipments", json=EVENT if body is None else body, headers=request_headers)

    async def test_health_missing_token_and_no_mint_endpoint(self):
        health = await self.client.get("/health")
        self.assertEqual(health.json(), {"status": "ok"})
        self.assertIn("x-correlation-id", health.headers)
        response = await self.client.post("/api/shipments", json=EVENT)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"], "missing_token")
        self.assertEqual(response.headers["www-authenticate"], "Bearer")
        self.assertEqual((await self.client.get("/issue-local-token")).status_code, 404)

    async def test_invalid_token_matrix(self):
        cases = [
            "not-a-jwt", token(key="z" * 48), token(aud="other"), token(iss="https://wrong.invalid"),
            token(exp=int(time.time()) - 300), token(nbf=int(time.time()) + 300),
            token(remove=["exp"]), token(algorithm="HS384"), token(aud=None),
            token(exp=float("inf")), token(exp=[]),
        ]
        for bearer in cases:
            with self.subTest(bearer=bearer[:8]):
                response = await self.send(bearer, body={"not": "valid"})
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.json()["error"], "invalid_token")
        records = [json.loads(line) for line in self.log_output.getvalue().splitlines()]
        self.assertTrue(all(row["CallerClientId"] == "unknown" for row in records))
        self.assertNotIn(cases[0], self.log_output.getvalue())

    async def test_authorization_reasons_precede_body_validation(self):
        cases = [
            (token(tid=OTHER), "wrong_tenant"), (token(azp=OTHER), "caller_not_allowed"),
            (token(azp="not-a-guid"), "caller_not_allowed"),
            (token(remove=["roles"]), "missing_role"), (token(roles=["other"]), "missing_role"),
            (token(remove=["idtyp"]), "app_only_required"), (token(idtyp="user"), "app_only_required"),
        ]
        cases += [(token(**{claim: ""}), "app_only_required") for claim in ("scp", "upn", "preferred_username", "unique_name")]
        for bearer, reason in cases:
            with self.subTest(reason=reason):
                response = await self.client.post("/api/shipments", content="{", headers={"Authorization": "Bearer " + bearer})
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.json()["error"], reason)

    async def test_appid_fallback_normalization_and_azp_precedence(self):
        response = await self.send(token(remove=["azp"], appid="{" + CALLER.replace("-", "") + "}"))
        self.assertEqual(response.status_code, 200)
        replayed = await self.send()
        self.assertTrue(replayed.json()["replayed"])
        denied = await self.send(token(azp=OTHER, appid=CALLER))
        self.assertEqual(denied.json()["error"], "caller_not_allowed")

    async def test_clock_skew_and_role_string(self):
        response = await self.send(token(exp=int(time.time()) - 10, nbf=int(time.time()) - 60, roles="Shipment.Invoke"))
        self.assertEqual(response.status_code, 200)

    async def test_loopback_is_socket_address_not_forwarded_headers(self):
        for address in ("10.0.0.2", "localhost", None):
            with self.subTest(address=address):
                transport = httpx.ASGITransport(app=self.app, client=(address, 123) if address else None)
                async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as client:
                    response = await client.post("/api/shipments", json=EVENT, headers={
                        "Authorization": "Bearer " + token(), "X-Forwarded-For": "127.0.0.1", "Forwarded": "for=127.0.0.1"
                    })
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.json()["error"], "local_requires_loopback")
        for address in ("::1", "::ffff:127.0.0.1"):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app, client=(address, 123)), base_url="http://localhost") as client:
                self.assertEqual((await client.get("/health")).status_code, 200)

    async def test_correlation_validation_duplicates_and_attribution(self):
        for values in ([""], ["x" * 65], ["with space"], ["two,values"], ["x", "x"], ["x\n"], ["é"]):
            with self.subTest(values=values):
                response = await self.send(headers=[("X-Correlation-ID", value.encode("utf-8")) for value in values])
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["error"], "invalid_correlation_id")
                self.assertRegex(response.headers["x-correlation-id"], r"^[a-f0-9-]{36}$")
        response = await self.send(headers=[("X-Correlation-ID", "a" * 64)])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["x-correlation-id"], "a" * 64)
        records = [json.loads(line) for line in self.log_output.getvalue().splitlines()]
        rejected = [row for row in records if row.get("Reason") == "invalid_correlation_id"]
        self.assertTrue(all(row["CallerClientId"] == CALLER for row in rejected))

    async def test_strict_body_shape_and_limits(self):
        invalid = [
            b"{", b"null", b"[]", b"true", b'"text"',
            json.dumps({**EVENT, "delayHours": 12.0}).encode(),
            json.dumps({**EVENT, "delayHours": True}).encode(),
            json.dumps({**EVENT, "delayHours": "12"}).encode(),
            json.dumps({**EVENT, "orderId": 123}).encode(),
            json.dumps({**EVENT, "sourceEventId": ["x"]}).encode(),
            b'{"sourceEventId":"x","orderId":"o","delayHours":NaN}',
            b"\xff",
        ]
        for body in invalid:
            with self.subTest(body=body[:50]):
                response = await self.client.post("/api/shipments", content=body,
                                                 headers={"Authorization": "Bearer " + token(), "Content-Type": "application/json"})
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["error"], "invalid_request")
        for body in ({}, {**EVENT, "sourceEventId": ""}, {**EVENT, "orderId": "a" * 101},
                     {**EVENT, "orderId": "a b"}, {**EVENT, "sourceEventId": "é"},
                     {**EVENT, "delayHours": 0}, {**EVENT, "delayHours": 721}):
            self.assertEqual((await self.send(body=body)).json()["error"], "invalid_event")
        encoded = json.dumps(EVENT).encode()
        exact = encoded + b" " * (BODY_LIMIT - len(encoded))
        for content, status in ((exact, 200), (exact + b" ", 413)):
            response = await self.client.post("/api/shipments", content=content, headers={
                "Authorization": "Bearer " + token(), "Content-Type": "application/json"
            })
            self.assertEqual(response.status_code, status)
        async def chunks():
            yield b" " * 8192
            yield b" " * 8192
            yield b" " * 1
        response = await self.client.post("/api/shipments", content=chunks(), headers={
            "Authorization": "Bearer " + token(), "Content-Type": "application/json"
        })
        self.assertEqual(response.status_code, 413)
        unsupported = await self.client.post("/api/shipments", content="{}", headers={"Authorization": "Bearer " + token()})
        self.assertEqual(unsupported.status_code, 415)

    async def test_fixed_workflow_result_logs_and_replay(self):
        with patch("httpx.AsyncClient.send", side_effect=AssertionError("No real network")):
            # Call the ASGI transport directly so only unexpected outbound HTTP would fail.
            request = self.client.build_request("POST", "/api/shipments", json=EVENT,
                                              headers={"Authorization": "Bearer " + token(), "X-Correlation-ID": "first"})
            response = await self.client._transport.handle_async_request(request)
            await response.aread()
        self.assertEqual(response.status_code, 200)
        result = response.json()["result"]
        self.assertEqual(result["summary"], "Local simulation: order ORDER-1 is delayed by 12 hours. "
                         "Bergamo has 50 units of WIDGET-42; the order needs 20. "
                         "Ask the operations team to assess an alternative shipment. No shipment has been changed.")
        self.assertEqual(result["reasoningMode"], "Stub")
        self.assertEqual(result["notificationId"], "stub-notification-" + result["runId"])
        self.assertEqual(result["ticketId"], "stub-ticket-" + result["runId"])
        retry = await self.send(headers=[("X-Correlation-ID", "retry")])
        self.assertTrue(retry.json()["replayed"])
        self.assertEqual(retry.json()["result"], result)
        self.assertEqual(retry.headers["x-correlation-id"], "retry")
        conflict = await self.send(body={**EVENT, "orderId": "ORDER-2"})
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json()["error"], "payload_conflict")
        records = [json.loads(line) for line in self.log_output.getvalue().splitlines()]
        tools = [row for row in records if row["EventName"] == "tool.ended"]
        self.assertEqual([row["Operation"] for row in tools], ["read_order", "check_stock", "notify_operations", "create_ticket"])
        for row in tools:
            self.assertEqual(row["CallerClientId"], CALLER)
            self.assertEqual(row["CallerDisplayName"], "Local SAP middleware")
            self.assertEqual(row["SourceEventId"], EVENT["sourceEventId"])
            self.assertEqual(row["RunId"], result["runId"])
            self.assertEqual(row["PermissionMode"], "none")
            self.assertEqual(row["ToolMode"], "Stub")

    async def test_concurrent_requests_execute_once(self):
        entered, release = asyncio.Event(), asyncio.Event()
        async def summarize(*args):
            entered.set()
            await release.wait()
            return "Summary"
        reasoner = SimpleNamespace(mode="Stub", summarize=AsyncMock(side_effect=summarize))
        self.app.state.workflow.reasoner = reasoner
        first = asyncio.create_task(self.send())
        await entered.wait()
        duplicates = await asyncio.gather(*(self.send() for _ in range(12)))
        self.assertTrue(all(row.status_code == 409 and row.json()["error"] == "in_progress" for row in duplicates))
        release.set()
        self.assertEqual((await first).status_code, 200)
        self.assertTrue((await self.send()).json()["replayed"])
        reasoner.summarize.assert_awaited_once()

    async def test_partial_failure_is_retained(self):
        notify = AsyncMock(return_value="notification-was-sent")
        create = AsyncMock(side_effect=RuntimeError("downstream failed"))
        self.app.state.workflow.notifier = SimpleNamespace(notify=notify)
        self.app.state.workflow.tickets = SimpleNamespace(create=create)
        failed = await self.send()
        self.assertEqual(failed.status_code, 500)
        self.assertEqual(failed.json()["error"], "run_failed")
        retry = await self.send()
        self.assertEqual(retry.status_code, 409)
        self.assertEqual(retry.json()["error"], "failed")
        notify.assert_awaited_once()
        create.assert_awaited_once()
        records = [json.loads(line) for line in self.log_output.getvalue().splitlines()]
        failed_run = next(row for row in records if row["EventName"] == "run.failed")
        self.assertEqual(failed_run["CallerClientId"], CALLER)
        self.assertEqual(failed_run["SourceEventId"], EVENT["sourceEventId"])
        self.assertIn("RunId", failed_run)
        self.assertTrue(any(row["EventName"] == "run.ended" and row["Outcome"] == "failed" for row in records))

    async def test_400_events_then_400_replays_and_capacity(self):
        self.app.state.ledger.capacity = 400
        results = []
        for number in range(1, 401):
            response = await self.send(body={"sourceEventId": f"nightly-demo-{number}", "orderId": f"ORDER-{number}", "delayHours": 12})
            self.assertEqual(response.status_code, 200)
            self.assertFalse(response.json()["replayed"])
            results.append(response.json()["result"])
        for number in range(1, 401):
            response = await self.send(body={"sourceEventId": f"nightly-demo-{number}", "orderId": f"ORDER-{number}", "delayHours": 12})
            self.assertTrue(response.json()["replayed"])
            self.assertEqual(response.json()["result"], results[number - 1])
        extra = await self.send()
        self.assertEqual(extra.status_code, 503)
        self.assertEqual(extra.json()["error"], "capacity_reached")
        records = [json.loads(line) for line in self.log_output.getvalue().splitlines()]
        self.assertEqual(sum(row["EventName"] == "tool.ended" for row in records), 1600)


class LedgerTests(unittest.TestCase):
    def test_thread_safe_reservation_and_caller_isolation(self):
        ledger = EventLedger(2)
        shipment = ShipmentEvent("e", "o", 12)
        with ThreadPoolExecutor(max_workers=16) as pool:
            states = list(pool.map(lambda _: ledger.reserve(CALLER, shipment).state, range(100)))
        self.assertEqual(states.count("reserved"), 1)
        self.assertEqual(states.count("in_progress"), 99)
        self.assertEqual(ledger.reserve(OTHER, shipment).state, "reserved")
        ledger.finish(CALLER, shipment, None)
        self.assertEqual(ledger.reserve(CALLER, shipment).state, "failed")
        self.assertEqual(ledger.reserve(CALLER, ShipmentEvent("e", "different", 12)).state, "payload_conflict")
        self.assertEqual(ledger.reserve(CALLER, ShipmentEvent("new", "o", 12)).state, "capacity_reached")


class EntraTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        cls.first = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.second = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    @staticmethod
    def jwk(key, kid):
        return {**jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key(), as_dict=True), "kid": kid, "use": "sig", "alg": "RS256"}

    async def test_success_rotation_and_invalid_key(self):
        config = settings(app_environment="Production", ingress_mode="Entra")
        auth = Authenticator(config)
        fetch = AsyncMock(side_effect=[
            {"keys": [self.jwk(self.first, "first")]},
            {"keys": [self.jwk(self.second, "second")]},
            {"keys": [self.jwk(self.second, "second")]},
        ])
        with patch.object(auth.jwks, "fetch", fetch):
            for key, kid in ((self.first, "first"), (self.first, "first"), (self.second, "second")):
                claims, failure = await auth.authenticate(["Bearer " + token(
                    key=key, algorithm="RS256", headers={"kid": kid}, iss=config.issuer
                )])
                self.assertIsNotNone(claims)
                self.assertEqual(failure, "")
            self.assertEqual(fetch.await_count, 2)
            claims, failure = await auth.authenticate(["Bearer " + token(
                key=self.first, algorithm="RS256", headers={"kid": "unknown"}, iss=config.issuer
            )])
            self.assertIsNone(claims)
            self.assertEqual(failure, "invalid_token")

    async def test_rs256_signature_issuer_audience_and_algorithm_pinning(self):
        config = settings(app_environment="Production", ingress_mode="Entra")
        auth = Authenticator(config)
        with patch.object(auth.jwks, "fetch", AsyncMock(return_value={"keys": [self.jwk(self.first, "first")]})):
            for overrides in ({"iss": "https://wrong.invalid"}, {"aud": OTHER}, {"exp": 1}):
                value = {"iss": config.issuer, **overrides}
                claims, failure = await auth.authenticate(["Bearer " + token(key=self.first, algorithm="RS256", headers={"kid": "first"}, **value)])
                self.assertIsNone(claims)
                self.assertEqual(failure, "invalid_token")
            claims, _ = await auth.authenticate(["Bearer " + token(key=self.second, algorithm="RS256", headers={"kid": "first"}, iss=config.issuer)])
            self.assertIsNone(claims)
            claims, _ = await auth.authenticate(["Bearer " + token(iss=config.issuer)])
            self.assertIsNone(claims)

    async def test_jwks_fetch_failure_fails_closed(self):
        auth = Authenticator(settings(app_environment="Production", ingress_mode="Entra"))
        with patch.object(auth.jwks, "fetch", AsyncMock(side_effect=httpx.ConnectError("offline"))):
            claims, failure = await auth.authenticate(["Bearer " + token(key=self.first, algorithm="RS256", headers={"kid": "first"})])
        self.assertIsNone(claims)
        self.assertEqual(failure, "invalid_token")


class ModelTests(unittest.IsolatedAsyncioTestCase):
    def model_settings(self, **changes):
        return settings(**{
            "agent_reasoning_mode": "AzureOpenAI", "azure_openai_endpoint": "https://resource.openai.azure.com/",
            "azure_openai_deployment": "gpt-4.1", **changes,
        })

    async def test_all_three_explicit_credentials(self):
        with patch.dict(os.environ, {}, clear=True), patch("langchain_openai.AzureChatOpenAI") as model, \
             patch("azure.identity.ManagedIdentityCredential") as managed, \
             patch("azure.identity.ClientSecretCredential") as secret, \
             patch("azure.identity.get_bearer_token_provider", return_value=lambda: "own-workload-token") as provider:
            for identity in ("", OTHER):
                build_model(self.model_settings(azure_openai_managed_identity_client_id=identity))
                self.assertEqual(managed.call_args.kwargs, {"client_id": OTHER} if identity else {})
                self.assertEqual(model.call_args.kwargs["azure_ad_token_provider"](), "own-workload-token")
                self.assertEqual(provider.call_args.args[1], "https://cognitiveservices.azure.com/.default")
            build_model(self.model_settings(azure_openai_authentication="ClientSecret",
                                           azure_openai_tenant_id=TENANT, azure_openai_client_id=CALLER,
                                           azure_openai_client_secret="test-secret"))
            secret.assert_called_once_with(tenant_id=TENANT, client_id=CALLER, client_secret="test-secret")
            build_model(self.model_settings(azure_openai_authentication="ApiKey", azure_openai_api_key="test-key"))
            self.assertEqual(model.call_args.kwargs["api_key"], "test-key")
            self.assertNotIn("azure_ad_token_provider", model.call_args.kwargs)
            self.assertIsNone(model.call_args.kwargs["azure_ad_token"])

    async def test_ambient_token_and_bad_model_settings_fail_closed(self):
        with patch.dict(os.environ, {"AZURE_OPENAI_AD_TOKEN": "not-a-workload-credential"}):
            with self.assertRaisesRegex(ValueError, "Remove AZURE_OPENAI_AD_TOKEN"):
                build_model(self.model_settings())
        for changes in (
            {"azure_openai_authentication": "DefaultAzureCredential"}, {"azure_openai_authentication": "ApiKey"},
            {"azure_openai_authentication": "ClientSecret"}, {"azure_openai_deployment": ""},
        ):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.model_settings(**changes).validate_model()

    async def test_model_summary_no_tools_empty_and_error(self):
        model = SimpleNamespace(ainvoke=AsyncMock(return_value=SimpleNamespace(content="Summary")))
        with patch("app.reasoner.build_model", return_value=model):
            reasoner = AzureOpenAIExceptionReasoner(self.model_settings())
        shipment = ShipmentEvent("event", "order", 12)
        run = RunContext("run", "correlation", CALLER, "Caller")
        order = await StubOrderReader().read("order", run)
        inventory = await StubInventoryReader().read(order.sku, run)
        self.assertEqual(await reasoner.summarize(shipment, order, inventory), "Summary")
        messages = model.ainvoke.call_args.args[0]
        self.assertEqual([item[0] for item in messages], ["system", "human"])
        self.assertEqual(json.loads(messages[1][1])["shipment"], {"sourceEventId": "event", "orderId": "order", "delayHours": 12})
        model.ainvoke.return_value = SimpleNamespace(content=" ")
        with self.assertRaisesRegex(RuntimeError, "empty operations summary"):
            await reasoner.summarize(shipment, order, inventory)
        model.ainvoke.side_effect = RuntimeError("model failed")
        with self.assertRaisesRegex(RuntimeError, "model failed"):
            await reasoner.summarize(shipment, order, inventory)


class ReplayTests(unittest.TestCase):
    def test_origin_and_argument_bounds(self):
        import argparse
        for value in ("http://localhost:5168", "http://127.0.0.1:5168", "http://[::1]:5168", "https://example.invalid/"):
            self.assertEqual(origin(value), value.rstrip("/"))
        for value in ("http://example.invalid", "https://user:pass@example.invalid", "https://example.invalid/path",
                      "https://example.invalid?x=1", "https://example.invalid#x", "file:///etc", "http://localhost.evil", "https://x:99999"):
            with self.subTest(value=value), self.assertRaises(argparse.ArgumentTypeError):
                origin(value)
        for parser, values in ((bounded_integer(1, 10000), ("0", "10001", "1.0", "-1")), (batch_id, ("", "a" * 33, "a.b"))):
            for value in values:
                with self.assertRaises(argparse.ArgumentTypeError):
                    parser(value)

    def test_report_redirect_network_and_malformed_failures(self):
        responses = iter([
            httpx.Response(200, json={"replayed": False, "result": {}}),
            httpx.Response(200, json={"replayed": True, "result": {}}),
            httpx.Response(302, headers={"location": "https://other.invalid"}),
            httpx.Response(200, text="not json"),
        ])
        with httpx.Client(transport=httpx.MockTransport(lambda request: next(responses)),
                          base_url="http://localhost", follow_redirects=False) as client, contextlib.redirect_stderr(io.StringIO()):
            report = replay(client, count=4, batch="demo")
        self.assertEqual({key: report[key] for key in ("Attempts", "NewRuns", "Replays", "Failed")},
                         {"Attempts": 4, "NewRuns": 1, "Replays": 1, "Failed": 2})

    def test_cli_failure_exit_and_no_token_on_command_line(self):
        with patch.dict(os.environ, {}, clear=True), patch("app.replay.load_dotenv"), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(replay_main([]), 1)
        with patch.dict(os.environ, {"S2S_CALLER_TOKEN": "test-token"}, clear=True), \
             patch("app.replay.load_dotenv"), patch("app.replay.httpx.Client") as client, \
             patch("app.replay.replay", return_value={"Failed": 1}), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(replay_main(["--count", "1"]), 1)
            self.assertFalse(client.call_args.kwargs["follow_redirects"])


class ContextTests(unittest.IsolatedAsyncioTestCase):
    async def test_log_context_flows_into_async_tasks_and_is_isolated(self):
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
            with log_scope(CorrelationId="first", CallerClientId=CALLER):
                first = asyncio.create_task(child())
            with log_scope(CorrelationId="second", CallerClientId=OTHER):
                second = asyncio.create_task(child())
            await asyncio.gather(first, second)
        finally:
            logger.removeHandler(handler)
            logger.setLevel(old_level)
        records = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual({row["CorrelationId"]: row["CallerClientId"] for row in records}, {"first": CALLER, "second": OTHER})


if __name__ == "__main__":
    unittest.main()
