import argparse
import sys

from app.auth import issue_local_token
from app.config import Settings


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the supply-chain exception agent.")
    parser.add_argument("--issue-local-token", action="store_true", help="Issue a one-hour local token and exit.")
    args = parser.parse_args()
    try:
        settings = Settings()
        if args.issue_local_token:
            print(issue_local_token(settings))
            return 0
        import uvicorn

        from app.logs import configure_logging, log_event
        from app.main import create_app

        app = create_app(settings)
        configure_logging()
        log_event("host.started", IdentityMode=settings.ingress_mode,
                  ReasoningMode=settings.agent_reasoning_mode, ToolMode="Stub")
        uvicorn.run(app, host=settings.host, port=settings.port, workers=1, proxy_headers=False,
                    forwarded_allow_ips="", access_log=False, log_config=None)
        return 0
    except Exception as error:
        print(f"Startup failed ({type(error).__name__}): {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
