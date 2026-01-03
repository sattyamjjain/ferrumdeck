"""Agentic executor for running full LLM + Tool loops."""

import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from fd_mcp_router.config import MCPServerConfig, ToolAllowlist
from fd_worker.llm import (
    LLMExecutor,
    LLMUsage,
    ToolCall,
    convert_mcp_tools_to_llm_format,
)

logger = logging.getLogger(__name__)


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
        max_iterations: int = 10,
    ):
        self.mcp_configs = mcp_configs
        self.allowlist = allowlist
        self.max_iterations = max_iterations
        self.llm_executor = LLMExecutor()

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

    async def _execute_tool(
        self,
        tool_call: ToolCall,
    ) -> ToolResult:
        """Execute a single tool call."""
        tool_name = tool_call.name

        # Check allowlist
        status = self.allowlist.check(tool_name)

        if status == "denied":
            return ToolResult(
                tool_call_id=tool_call.id,
                tool_name=tool_name,
                success=False,
                output=None,
                error=f"Tool '{tool_name}' is denied by policy",
            )

        if status == "requires_approval":
            # For now, log and continue - in production this would trigger approval flow
            logger.warning(f"Tool {tool_name} requires approval - executing anyway for demo")

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
    ) -> AgenticResult:
        """Run an agentic loop to complete a task.

        Args:
            task: The user's task/request
            system_prompt: System prompt for the agent
            model: LLM model to use
            max_tokens: Max tokens per LLM call
            temperature: Sampling temperature

        Returns:
            AgenticResult with final response and execution details
        """
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

                # Execute each tool call
                for tc in response.tool_calls:
                    result = await self._execute_tool(tc)

                    # Record the tool call
                    tool_calls_made.append(
                        {
                            "tool_name": tc.name,
                            "arguments": tc.arguments,
                            "success": result.success,
                            "output_preview": str(result.output)[:200] if result.output else None,
                            "error": result.error,
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
