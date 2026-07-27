"""Agentic executor for running full LLM + Tool loops."""

import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from fd_mcp_router.config import MCPServerConfig, ToolAllowlist
from fd_runtime.client import ControlPlaneClient
from fd_worker.llm import (
    LLMExecutor,
    LLMUsage,
    ToolCall,
    convert_mcp_tools_to_llm_format,
)

logger = logging.getLogger(__name__)


def _env_bool(name: str, default: bool) -> bool:
    """Parse a boolean env var. Anything but an explicit false-y value keeps the
    (safe) default — a typo must not silently open the gate."""
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


@dataclass
class ToolInfo:
    """Information about an available tool."""

    name: str
    server_name: str
    description: str
    input_schema: dict[str, Any]


@dataclass
class ToolResult:
    """Result from a tool call."""

    tool_call_id: str
    tool_name: str
    success: bool
    output: Any
    error: str | None = None
    # The enforcement decision that governed this call — surfaced onto the run
    # record so a refusal is visible, not silent. One of:
    # "allow" | "deny" | "requires_approval" | "fail_closed" | None (not gated).
    decision: str | None = None


@dataclass
class AgenticResult:
    """Result from an agentic execution."""

    final_response: str
    tool_calls_made: list[dict[str, Any]] = field(default_factory=list)
    total_usage: LLMUsage = field(default_factory=lambda: LLMUsage(0, 0))
    iterations: int = 0
    status: str = "completed"
    error: str | None = None


class MCPConnection:
    """Manages a persistent connection to an MCP server."""

    def __init__(self, config: MCPServerConfig):
        self.config = config
        self.session: ClientSession | None = None
        self.tools: list[ToolInfo] = []
        self._context_stack: list[Any] = []

    async def connect(self) -> list[ToolInfo]:
        """Connect to the MCP server and return discovered tools."""
        if not self.config.command:
            logger.warning(f"No command for server {self.config.name}")
            return []

        logger.info(f"Connecting to MCP server: {self.config.name}")
        logger.info(f"Command: {self.config.command} {' '.join(self.config.args or [])}")

        # Build environment - inherit from current process and add configured env
        env = dict(os.environ)
        if self.config.env:
            env.update(self.config.env)

        server_params = StdioServerParameters(
            command=self.config.command,
            args=self.config.args or [],
            env=env,
        )

        try:
            # Enter the context managers manually to keep connection alive
            stdio_ctx = stdio_client(server_params)
            read_stream, write_stream = await stdio_ctx.__aenter__()
            self._context_stack.append(stdio_ctx)

            session_ctx = ClientSession(read_stream, write_stream)
            self.session = await session_ctx.__aenter__()
            self._context_stack.append(session_ctx)

            await self.session.initialize()

            # Discover tools
            tools_response = await self.session.list_tools()
            self.tools = []

            for tool in tools_response.tools:
                self.tools.append(
                    ToolInfo(
                        name=tool.name,
                        server_name=self.config.name,
                        description=tool.description or "",
                        input_schema=tool.inputSchema or {},
                    )
                )

            logger.info(f"Connected to {self.config.name}, discovered {len(self.tools)} tools")
            for tool in self.tools:
                logger.info(f"  - {tool.name}: {tool.description[:60]}...")

            return self.tools
        except Exception as e:
            logger.error(f"Failed to connect to MCP server {self.config.name}: {e}")
            # Clean up any partial state
            self._context_stack.clear()
            self.session = None
            return []

    async def call_tool(self, tool_name: str, arguments: dict[str, Any]) -> Any:
        """Call a tool and return the result."""
        if not self.session:
            raise RuntimeError(f"Not connected to server {self.config.name}")

        result = await self.session.call_tool(tool_name, arguments)

        # Process result content
        output_parts = []
        for content in result.content:
            if hasattr(content, "text"):
                output_parts.append(content.text)
            elif hasattr(content, "data"):
                output_parts.append(str(content.data))
            else:
                output_parts.append(str(content))

        return "\n".join(output_parts) if output_parts else ""

    async def disconnect(self) -> None:
        """Disconnect from the server."""
        if not self._context_stack:
            self.session = None
            return

        for ctx in reversed(self._context_stack):
            try:
                await ctx.__aexit__(None, None, None)
            except RuntimeError as e:
                # Handle async cancel scope issues gracefully
                if "cancel scope" in str(e).lower():
                    logger.debug(f"Ignoring cancel scope error during disconnect: {e}")
                else:
                    logger.warning(f"Error closing context: {e}")
            except Exception as e:
                logger.warning(f"Error closing context: {e}")
        self._context_stack.clear()
        self.session = None


class AgenticExecutor:
    """Executes agentic loops with LLM and MCP tools.

    This executor handles the full cycle of:
    1. Sending a task to the LLM with available tools
    2. If LLM requests tool calls, execute them via MCP
    3. Send tool results back to LLM
    4. Repeat until LLM produces final response
    """

    def __init__(
        self,
        mcp_configs: list[MCPServerConfig],
        allowlist: ToolAllowlist,
        max_iterations: int = 25,
        control_plane_client: ControlPlaneClient | None = None,
        fail_closed: bool = True,
    ):
        self.mcp_configs = mcp_configs
        self.allowlist = allowlist
        self.max_iterations = max_iterations
        self.llm_executor = LLMExecutor()

        # The control plane is the FINAL authority on every tool call. The local
        # allowlist below is only a cheap pre-filter. When the control plane is
        # unreachable, `fail_closed` decides the default: refuse (True) — never
        # execute an unauthorized call just because the gateway is down.
        self._control_plane_client = control_plane_client
        self._fail_closed = fail_closed
        self._run_id: str | None = None

        self._connections: dict[str, MCPConnection] = {}
        self._tool_to_server: dict[str, str] = {}
        self._all_tools: list[ToolInfo] = []
        self._llm_tools: list[dict[str, Any]] = []

    async def connect(self) -> None:
        """Connect to all MCP servers and discover tools."""
        for config in self.mcp_configs:
            conn = MCPConnection(config)
            try:
                tools = await conn.connect()
                self._connections[config.name] = conn

                for tool in tools:
                    self._tool_to_server[tool.name] = config.name
                    self._all_tools.append(tool)
            except Exception as e:
                logger.error(f"Failed to connect to {config.name}: {e}")

        # Convert to LLM format
        self._llm_tools = convert_mcp_tools_to_llm_format(
            [
                {
                    "name": t.name,
                    "description": t.description,
                    "inputSchema": t.input_schema,
                }
                for t in self._all_tools
            ]
        )

        # Filter to only allowed tools
        allowed_tool_names = set(self.allowlist.allowed_tools + self.allowlist.approval_required)
        self._llm_tools = [
            t for t in self._llm_tools if t["function"]["name"] in allowed_tool_names
        ]

        logger.info(f"AgenticExecutor ready with {len(self._llm_tools)} tools available to LLM")

    async def disconnect(self) -> None:
        """Disconnect from all MCP servers."""
        for conn in self._connections.values():
            await conn.disconnect()
        self._connections.clear()

    def _refusal(self, tool_call: ToolCall, decision: str, reason: str) -> ToolResult:
        """A non-executing tool result carrying the enforcement decision."""
        return ToolResult(
            tool_call_id=tool_call.id,
            tool_name=tool_call.name,
            success=False,
            output=None,
            error=reason,
            decision=decision,
        )

    async def _authorize(self, run_id: str | None, tool_call: ToolCall) -> ToolResult | None:
        """Ask the control plane whether this tool call may proceed, BEFORE it
        runs. Returns a refusal ``ToolResult`` if the call must not execute, or
        ``None`` if it is authorized to proceed.

        Enforcement contract (mirrors the gateway ``POST
        /v1/runs/{run_id}/check-tool`` handler): ``allowed`` → proceed;
        ``requires_approval`` → do not execute, the run is gated pending human
        approval; otherwise → denied. If the control plane cannot be consulted
        (no client / no run_id / gateway unreachable), we **fail closed** and
        refuse by default — an unauthorized call must never run just because the
        decision plane is unavailable.
        """
        tool_name = tool_call.name

        if self._control_plane_client is None or not run_id:
            if self._fail_closed:
                logger.error(
                    "event=fail_closed tool=%s run_id=%s reason=no_control_plane_context "
                    "-> refusing (the control plane is the required authority)",
                    tool_name,
                    run_id,
                )
                return self._refusal(
                    tool_call,
                    "fail_closed",
                    f"Tool '{tool_name}' refused (fail-closed): no control plane "
                    "available to authorize this call before execution",
                )
            logger.warning(
                "Tool %s: no control-plane context and fail-open configured — executing UNGOVERNED",
                tool_name,
            )
            return None

        try:
            resp = await self._control_plane_client.check_tool_policy(
                run_id=run_id,
                tool_name=tool_name,
                tool_input=tool_call.arguments,
            )
        except Exception as e:  # network / 5xx / auth / run-not-found
            if self._fail_closed:
                logger.error(
                    "event=fail_closed tool=%s run_id=%s reason=check_tool_unreachable "
                    "error=%s -> refusing",
                    tool_name,
                    run_id,
                    e,
                )
                return self._refusal(
                    tool_call,
                    "fail_closed",
                    f"Tool '{tool_name}' refused (fail-closed): control plane "
                    f"unreachable, cannot authorize before execution ({e})",
                )
            logger.warning(
                "Tool %s: check-tool failed (%s) and fail-open configured — executing UNGOVERNED",
                tool_name,
                e,
            )
            return None

        if resp.requires_approval:
            # Do NOT execute. The gateway has already gated the run pending
            # approval (RunStatus::PolicyBlocked + a POLICY_APPROVAL_REQUIRED
            # audit event); an operator resolves it via PUT /v1/approvals/{id}.
            logger.warning(
                "Tool %s requires approval — NOT executing; run gated pending approval: %s",
                tool_name,
                resp.reason,
            )
            return self._refusal(
                tool_call,
                "requires_approval",
                f"Tool '{tool_name}' requires approval before execution "
                f"(pending): {resp.reason}",
            )

        if not resp.allowed:
            logger.warning("Tool %s denied by control plane: %s", tool_name, resp.reason)
            return self._refusal(
                tool_call,
                "deny",
                f"Tool '{tool_name}' denied by policy: {resp.reason}",
            )

        return None  # authorized to proceed

    async def _execute_tool(
        self,
        tool_call: ToolCall,
        run_id: str | None = None,
    ) -> ToolResult:
        """Execute a single tool call, gated by the control plane before it runs.

        The local allowlist is only a cheap pre-filter (a fast local deny with no
        network round-trip); it can only ever *add* restriction and is **never**
        the final authority. Every call that survives the pre-filter is
        authorized by the control-plane ``check-tool`` endpoint before execution
        (see :meth:`_authorize`), which fails closed if the gateway is
        unreachable.
        """
        tool_name = tool_call.name
        run_id = run_id if run_id is not None else self._run_id

        # 1. Cheap local pre-filter — an explicit local deny short-circuits
        #    without a network round-trip. (More-restrictive-only; the control
        #    plane below is the authority for allow / approval.)
        if self.allowlist.check(tool_name) == "denied":
            logger.warning("Tool %s denied by local allowlist pre-filter", tool_name)
            return self._refusal(
                tool_call, "deny", f"Tool '{tool_name}' is denied by policy"
            )

        # 2. Control-plane check-tool is the FINAL, pre-execution authority.
        refusal = await self._authorize(run_id, tool_call)
        if refusal is not None:
            return refusal

        # Find server for this tool
        server_name = self._tool_to_server.get(tool_name)
        if not server_name:
            return ToolResult(
                tool_call_id=tool_call.id,
                tool_name=tool_name,
                success=False,
                output=None,
                error=f"No server found for tool: {tool_name}",
            )

        conn = self._connections.get(server_name)
        if not conn:
            return ToolResult(
                tool_call_id=tool_call.id,
                tool_name=tool_name,
                success=False,
                output=None,
                error=f"Server {server_name} is not connected",
            )

        try:
            logger.info(f"Executing tool: {tool_name}")
            logger.info(f"Arguments: {json.dumps(tool_call.arguments, indent=2)}")

            output = await conn.call_tool(tool_name, tool_call.arguments)

            logger.info(f"Tool {tool_name} succeeded, output length: {len(str(output))}")

            return ToolResult(
                tool_call_id=tool_call.id,
                tool_name=tool_name,
                success=True,
                output=output,
            )
        except Exception as e:
            logger.exception(f"Tool {tool_name} failed")
            return ToolResult(
                tool_call_id=tool_call.id,
                tool_name=tool_name,
                success=False,
                output=None,
                error=str(e),
            )

    async def run(
        self,
        task: str,
        system_prompt: str,
        model: str = "claude-sonnet-4-20250514",
        max_tokens: int = 4096,
        temperature: float = 0.7,
        run_id: str | None = None,
    ) -> AgenticResult:
        """Run an agentic loop to complete a task.

        Args:
            task: The user's task/request
            system_prompt: System prompt for the agent
            model: LLM model to use
            max_tokens: Max tokens per LLM call
            temperature: Sampling temperature
            run_id: The run this loop belongs to. Used to authorize every tool
                call against the control plane's ``check-tool`` endpoint. When
                omitted the executor fails closed (refuses tool calls) unless
                explicitly configured fail-open.

        Returns:
            AgenticResult with final response and execution details
        """
        self._run_id = run_id
        if run_id is None:
            logger.warning(
                "AgenticExecutor.run called without run_id — tool calls cannot be "
                "authorized against the control plane and will fail closed"
            )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": task},
        ]

        total_usage = LLMUsage(0, 0)
        tool_calls_made: list[dict[str, Any]] = []
        iterations = 0

        while iterations < self.max_iterations:
            iterations += 1
            logger.info(f"Agentic loop iteration {iterations}")

            # Call LLM with tools
            try:
                response = await self.llm_executor.complete(
                    messages=messages,
                    model=model,
                    tools=self._llm_tools if self._llm_tools else None,
                    max_tokens=max_tokens,
                    temperature=temperature,
                )
            except Exception as e:
                logger.exception("LLM call failed")
                return AgenticResult(
                    final_response="",
                    tool_calls_made=tool_calls_made,
                    total_usage=total_usage,
                    iterations=iterations,
                    status="error",
                    error=str(e),
                )

            total_usage = total_usage + response.usage

            # Check if LLM made tool calls
            if response.has_tool_calls:
                logger.info(f"LLM requested {len(response.tool_calls)} tool calls")

                # Add assistant message with tool calls to history
                messages.append(
                    self.llm_executor.format_assistant_tool_calls_message(
                        response.content,
                        response.tool_calls,
                    )
                )

                # Execute each tool call — every one is authorized by the
                # control plane before it runs (see _execute_tool).
                for tc in response.tool_calls:
                    result = await self._execute_tool(tc, run_id=self._run_id)

                    # Record the tool call, including the enforcement decision so
                    # a refusal (deny / requires_approval / fail_closed) is
                    # visible on the run record, not silently dropped.
                    tool_calls_made.append(
                        {
                            "tool_name": tc.name,
                            "arguments": tc.arguments,
                            "success": result.success,
                            "output_preview": str(result.output)[:200] if result.output else None,
                            "error": result.error,
                            "decision": result.decision,
                        }
                    )

                    # Add tool result to messages
                    if result.success:
                        messages.append(
                            self.llm_executor.format_tool_result_message(
                                tc.id,
                                result.output,
                            )
                        )
                    else:
                        messages.append(
                            self.llm_executor.format_tool_result_message(
                                tc.id,
                                f"Error: {result.error}",
                            )
                        )

                # Continue the loop
                continue

            # No tool calls - LLM is done
            logger.info(f"Agentic loop completed after {iterations} iterations")
            return AgenticResult(
                final_response=response.content,
                tool_calls_made=tool_calls_made,
                total_usage=total_usage,
                iterations=iterations,
                status="completed",
            )

        # Max iterations reached
        logger.warning(f"Agentic loop hit max iterations ({self.max_iterations})")
        return AgenticResult(
            final_response="Max iterations reached without completion",
            tool_calls_made=tool_calls_made,
            total_usage=total_usage,
            iterations=iterations,
            status="max_iterations",
        )
