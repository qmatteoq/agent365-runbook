import argparse
import json
import os
import re
import sys
import time
from urllib.parse import urlsplit
from uuid import uuid4

import httpx
from dotenv import load_dotenv

from app.auth import is_loopback


def origin(value: str) -> str:
    try:
        uri = urlsplit(value)
        loopback = uri.hostname == "localhost" or is_loopback(uri.hostname)
        if (
            not uri.hostname or uri.username is not None or uri.password is not None
            or uri.query or uri.fragment or "?" in value or "#" in value
            or uri.path not in ("", "/") or "\\" in value
            or (uri.scheme != "https" and not (uri.scheme == "http" and loopback))
            or any(char.isspace() or ord(char) < 32 for char in value)
            or (uri.port is not None and not 1 <= uri.port <= 65535)
        ):
            raise ValueError
    except ValueError:
        raise argparse.ArgumentTypeError("Base URL must be an HTTPS origin, or an HTTP loopback origin.") from None
    return value.rstrip("/")


def bounded_integer(minimum: int, maximum: int):
    def parse(value: str) -> int:
        normalized = value.lstrip("0") or "0"
        if (
            not re.fullmatch(r"[0-9]+", value) or len(normalized) > len(str(maximum))
            or not minimum <= int(normalized) <= maximum
        ):
            raise argparse.ArgumentTypeError(f"Expected an integer from {minimum} to {maximum}.")
        return int(normalized)
    return parse


def batch_id(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,32}", value):
        raise argparse.ArgumentTypeError("Batch ID must contain 1 to 32 ASCII letters, digits, underscores or hyphens.")
    return value


def replay(client: httpx.Client, *, count: int, batch: str, delay_ms: int = 0) -> dict[str, object]:
    started = time.perf_counter()
    accepted = replayed = failed = 0
    for number in range(1, count + 1):
        try:
            response = client.post(
                "/api/shipments", headers={"X-Correlation-ID": f"{batch}-{number}"},
                json={"sourceEventId": f"{batch}-{number}", "orderId": f"ORDER-{number}", "delayHours": 12},
            )
            if not response.is_success:
                raise ValueError(f"HTTP {response.status_code}")
            result = response.json()
            if not isinstance(result, dict) or type(result.get("replayed")) is not bool or not isinstance(result.get("result"), dict):
                raise ValueError("invalid response")
            if result["replayed"]:
                replayed += 1
            else:
                accepted += 1
        except (httpx.HTTPError, ValueError):
            failed += 1
            print(f"Event {number} failed.", file=sys.stderr)
        if delay_ms:
            time.sleep(delay_ms / 1000)
    return {"BatchId": batch, "Attempts": count, "NewRuns": accepted, "Replays": replayed,
            "Failed": failed, "DurationSeconds": round(time.perf_counter() - started, 2)}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Replay shipment events without following redirects.")
    parser.add_argument("--base-url", type=origin, default="http://localhost:5168")
    parser.add_argument("--count", type=bounded_integer(1, 10000), default=400)
    parser.add_argument("--batch-id", type=batch_id, default=uuid4().hex)
    parser.add_argument("--delay-ms", type=bounded_integer(0, 60000), default=0)
    args = parser.parse_args(argv)
    load_dotenv(".env", override=False)
    token = os.environ.get("S2S_CALLER_TOKEN", "").strip()
    if not token or any(char.isspace() for char in token):
        print("Set S2S_CALLER_TOKEN to a caller access token. Do not put bearer tokens on the command line.", file=sys.stderr)
        return 1
    with httpx.Client(
        base_url=args.base_url, timeout=120, follow_redirects=False,
        headers={"Authorization": f"Bearer {token}"},
    ) as client:
        report = replay(client, count=args.count, batch=args.batch_id, delay_ms=args.delay_ms)
    print(json.dumps(report))
    return 1 if report["Failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
