"""Worker entry point with tracing and MCP configuration."""

import asyncio
import contextlib
import json
import logging
import os
import signal
import socket
from pathlib import Path

from fd_mcp_router import MCPServerConfig, ToolAllowlist
from fd_runtime import init_tracing
from fd_worker.executor import StepExecutor
from fd_worker.queue import RedisQueueConsumer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)


def load_mcp_config() -> tuple[list[MCPServerConfig], ToolAllowlist]:
    """Load MCP server configuration from environment or file."""
    # Check for config file
    config_path = os.getenv("MCP_CONFIG_PATH")
    if config_path and Path(config_path).exists():
        with Path(config_path).open() as f:
            config = json.load(f)

        servers = [MCPServerConfig(**s) for s in config.get("servers", [])]
        allowlist = ToolAllowlist(**config.get("allowlist", {}))
        return servers, allowlist

    # Default configuration for Safe PR Agent
    servers = []

    # GitHub MCP Server (if configured)
    github_token = os.getenv("GITHUB_TOKEN")
    if github_token:
        servers.append(
            MCPServerConfig(
                name="github",
                command="npx",
                args=["-y", "@modelcontextprotocol/server-github"],
                env={"GITHUB_PERSONAL_ACCESS_TOKEN": github_token},
            )
        )

    # Filesystem MCP Server (if configured)
    workspace_path = os.getenv("WORKSPACE_PATH")
    if workspace_path:
        servers.append(
            MCPServerConfig(
                name="filesystem",
                command="npx",
                args=["-y", "@modelcontextprotocol/server-filesystem", workspace_path],
            )
        )

    # Default allowlist for Safe PR Agent
    allowlist = ToolAllowlist(
        allowed_tools=[
            # Read-only operations (always allowed)
            "read_file",
            "list_directory",
            "search_files",
            "get_file_contents",
            "list_commits",
            "get_pull_request",
        ],
        approval_required=[
            # Write operations (require approval)
            "write_file",
            "create_file",
            "create_pull_request",
            "create_issue",
            "push_files",
        ],
        denied_tools=[
            # Never allowed
            "delete_file",
            "delete_branch",
            "merge_pull_request",
        ],
    )

    return servers, allowlist


async def run_worker() -> None:
    """Run the worker loop."""
    # Configuration from environment
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
    control_plane_url = os.getenv("CONTROL_PLANE_URL", "http://localhost:8080")
    api_key = os.getenv("FD_API_KEY")
    otel_endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4317")
    worker_name = os.getenv("WORKER_NAME", f"worker-{socket.gethostname()}")

    # Initialize tracing
    init_tracing(service_name=worker_name, endpoint=otel_endpoint)

    logger.info(f"Starting FerrumDeck Worker: {worker_name}")
    logger.info(f"Redis URL: {redis_url}")
    logger.info(f"Control Plane URL: {control_plane_url}")
    logger.info(f"OTEL Endpoint: {otel_endpoint}")

    if not api_key:
        logger.warning("FD_API_KEY not set - worker cannot report results to control plane")

    # Load MCP configuration
    mcp_servers, tool_allowlist = load_mcp_config()
    logger.info(f"Loaded {len(mcp_servers)} MCP servers")
    logger.info(
        f"Tool allowlist: {len(tool_allowlist.allowed_tools)} allowed, "
        f"{len(tool_allowlist.approval_required)} require approval"
    )

    # Create components
    queue = RedisQueueConsumer(
        redis_url=redis_url,
        consumer_name=worker_name,
    )
    executor = StepExecutor(
        control_plane_url=control_plane_url,
        api_key=api_key,
        mcp_servers=mcp_servers,
        tool_allowlist=tool_allowlist,
    )

    # Shutdown handling
    shutdown_event = asyncio.Event()

    def handle_shutdown(sig: signal.Signals) -> None:
        logger.info(f"Received signal {sig.name}, initiating graceful shutdown...")
        shutdown_event.set()

    loop = asyncio.get_event_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, handle_shutdown, sig)

    jobs_processed = 0
    try:
        # Connect to services
        await queue.connect()
        await executor.connect()
        logger.info("Worker connected and ready for jobs")

        # Main work loop
        while not shutdown_event.is_set():
            try:
                # Poll for work with timeout
                job = await queue.poll(timeout=1.0)

                if job:
                    job_id = job.get("_message_id", "unknown")
                    run_id = job.get("run_id", "unknown")
                    step_id = job.get("step_id", "unknown")

                    logger.info(f"Processing job: run={run_id} step={step_id}")

                    try:
                        await executor.execute(job)
                        await queue.ack(job_id)
                        jobs_processed += 1
                        logger.info(f"Job completed: run={run_id} step={step_id}")
                    except Exception:
                        logger.exception(f"Job failed: run={run_id} step={step_id}")
                        # Don't ack - will be retried or go to dead letter queue

                else:
                    # No job available, brief sleep
                    await asyncio.sleep(0.1)

            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("Error in worker loop")
                await asyncio.sleep(1.0)  # Back off on errors

    finally:
        logger.info(f"Shutting down after processing {jobs_processed} jobs")
        await executor.disconnect()
        await queue.disconnect()
        logger.info("Worker shutdown complete")


def main() -> None:
    """Entry point."""
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(run_worker())


if __name__ == "__main__":
    main()
