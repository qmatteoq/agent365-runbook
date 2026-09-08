import json
import logging
import sys
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Iterator

_context: ContextVar[dict[str, object]] = ContextVar("log_context", default={})
logger = logging.getLogger("supply_chain")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        fields = {
            "Timestamp": datetime.now(timezone.utc).isoformat(),
            "LogLevel": record.levelname,
            "Category": record.name,
            "Message": record.getMessage(),
            **getattr(record, "fields", {}),
        }
        return json.dumps(fields, ensure_ascii=True, allow_nan=False)


def configure_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logger.handlers = [handler]
    logger.setLevel(logging.INFO)
    logger.propagate = False


@contextmanager
def log_scope(**fields: object) -> Iterator[None]:
    token = _context.set({**_context.get(), **fields})
    try:
        yield
    finally:
        _context.reset(token)


def log_event(event_name: str, *, level: int = logging.INFO, **fields: object) -> None:
    logger.log(level, event_name, extra={"fields": {**_context.get(), "EventName": event_name, **fields}})
