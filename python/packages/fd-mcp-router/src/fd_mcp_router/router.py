"""MCP tool router with deny-by-default semantics."""

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from fd_mcp_router.config import MCPServerConfig, ToolAllowlist

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

    success: bool
    output: Any
    error: str | None = None
    server: str | None = None
    tool: str | None = None


@dataclass
class ServerConnection:
    """Active connection to an MCP server."""

    config: MCPServerConfig
    session: ClientSession | None = None
    tools: list[ToolInfo] = field(default_factory=list)
    connected: bool = False
    _read_task: asyncio.Task[None] | None = None
    _write_task: asyncio.Task[None] | None = None


class MCPRouter:
    """Routes tool calls to MCP servers with policy enforcement.

    Features:
    - Deny-by-default: Only explicitly allowed tools can be called
    - Tool discovery: Automatically discovers tools from connected servers
    - Provenance logging: Logs server, tool, and version for every call
    - Schema validation: Validates inputs against tool schemas
    """

    def __init__(
        self,
        servers: list[MCPServerConfig] | None = None,
        allowlist: ToolAllowlist | None = None,
    ):
        self.servers: dict[str, MCPServerConfig] = {s.name: s for s in (servers or [])}
        self.allowlist = allowlist or ToolAllowlist()
        self._connections: dict[str, ServerConnection] = {}
        self._tool_to_server: dict[str, str] = {}

    async def connect(self) -> None:
        """Connect to all configured MCP servers and discover tools."""
        for name, config in self.servers.items():
            try:
                await self._connect_server(name, config)
            except Exception as e:
                logger.error(f"Failed to connect to MCP server {name}: {e}")

    async def _connect_server(self, name: str, config: MCPServerConfig) -> None:
        """Connect to a single MCP server."""
        logger.info(f"Connecting to MCP server: {name}")

        if config.command:
            # Stdio-based server
            server_params = StdioServerParameters(
                command=config.command,
                args=config.args or [],
                env=config.env,
            )

            async with (
                stdio_client(server_params) as (read_stream, write_stream),
                ClientSession(read_stream, write_stream) as session,
            ):
                await session.initialize()

                # Discover available tools
                tools_response = await session.list_tools()
                tools = []

                for tool in tools_response.tools:
                    tool_info = ToolInfo(
                        name=tool.name,
                        server_name=name,
                        description=tool.description or "",
                        input_schema=tool.inputSchema or {},
                    )
                    tools.append(tool_info)
                    self._tool_to_server[tool.name] = name

                self._connections[name] = ServerConnection(
                    config=config,
                    session=session,
                    tools=tools,
                    connected=True,
                )

                logger.info(
                    f"Connected to {name}, discovered {len(tools)} tools: {[t.name for t in tools]}"
                )

        else:
            # For now, just create a placeholder connection
            # URL-based servers would use a different transport
            self._connections[name] = ServerConnection(
                config=config,
                connected=False,
            )
            logger.warning(f"Server {name} has no command configured, skipping")

    async def disconnect(self) -> None:
        """Disconnect from all MCP servers."""
        for name, conn in self._connections.items():
            if conn.session:
                try:
                    # Sessions are managed by context managers
                    logger.info(f"Disconnecting from MCP server: {name}")
                except Exception as e:
                    logger.error(f"Error disconnecting from {name}: {e}")

        self._connections.clear()
        self._tool_to_server.clear()

    async def call_tool(
        self,
        tool_name: str,
        tool_input: dict[str, Any],
        run_id: str | None = None,
    ) -> ToolResult:
        """Call a tool through the router.

        Args:
            tool_name: Name of the tool to call
            tool_input: Input arguments for the tool
            run_id: Optional run ID for provenance logging

        Returns:
            ToolResult with success status and output

        Raises:
            PermissionError: If tool is denied by allowlist
            ValueError: If tool requires approval (should be handled by control plane)
        """
        # Check allowlist first (deny by default)
        status = self.allowlist.check(tool_name)

        if status == "denied":
            logger.warning(
                f"Tool call DENIED: {tool_name}",
                extra={"run_id": run_id, "tool": tool_name},
            )
            raise PermissionError(
                f"Tool '{tool_name}' is not in the allowlist and is denied by default"
            )

        if status == "requires_approval":
            logger.info(
                f"Tool call REQUIRES_APPROVAL: {tool_name}",
                extra={"run_id": run_id, "tool": tool_name},
            )
            raise ValueError(
                f"Tool '{tool_name}' requires approval before execution. "
                "This should be handled by the control plane."
            )

        # Find the server that provides this tool
        server_name = self._tool_to_server.get(tool_name)
        if not server_name:
            return ToolResult(
                success=False,
                output=None,
                error=f"No server found for tool: {tool_name}",
                tool=tool_name,
            )

        conn = self._connections.get(server_name)
        if not conn or not conn.session:
            return ToolResult(
                success=False,
                output=None,
                error=f"Server {server_name} is not connected",
                server=server_name,
                tool=tool_name,
            )

        # Log the call with provenance
        logger.info(
            f"Calling tool: {tool_name} on server: {server_name}",
            extra={
                "run_id": run_id,
                "tool": tool_name,
                "server": server_name,
                "input_keys": list(tool_input.keys()),
            },
        )

        try:
            # Call the tool via MCP
            result = await conn.session.call_tool(tool_name, tool_input)

            # Process result content
            output = []
            for content in result.content:
                if hasattr(content, "text"):
                    output.append({"type": "text", "text": content.text})
                elif hasattr(content, "data"):
                    output.append({"type": "resource", "data": content.data})
                else:
                    output.append({"type": "unknown", "content": str(content)})

            return ToolResult(
                success=not result.isError,
                output=output if len(output) > 1 else output[0] if output else None,
                error=None if not result.isError else str(output),
                server=server_name,
                tool=tool_name,
            )

        except Exception as e:
            logger.exception(f"Tool call failed: {tool_name}")
            return ToolResult(
                success=False,
                output=None,
                error=str(e),
                server=server_name,
                tool=tool_name,
            )

    def get_tool_info(self, tool_name: str) -> ToolInfo | None:
        """Get information about a specific tool."""
        server_name = self._tool_to_server.get(tool_name)
        if not server_name:
            return None

        conn = self._connections.get(server_name)
        if not conn:
            return None

        for tool in conn.tools:
            if tool.name == tool_name:
                return tool
        return None

    def list_available_tools(self) -> list[ToolInfo]:
        """List all tools that are allowed by the allowlist."""
        available = []
        for tool_name in self.allowlist.allowed_tools:
            info = self.get_tool_info(tool_name)
            if info:
                available.append(info)
        return available

    def list_all_discovered_tools(self) -> list[ToolInfo]:
        """List all tools discovered from connected servers."""
        tools = []
        for conn in self._connections.values():
            tools.extend(conn.tools)
        return tools

    def validate_tool_input(self, tool_name: str, tool_input: dict[str, Any]) -> list[str]:
        """Validate tool input against its schema.

        Returns a list of validation errors (empty if valid).
        """
        info = self.get_tool_info(tool_name)
        if not info:
            return [f"Unknown tool: {tool_name}"]

        errors = []
        schema = info.input_schema

        # Check required properties
        required = schema.get("required", [])
        for prop in required:
            if prop not in tool_input:
                errors.append(f"Missing required property: {prop}")

        # Check property types
        properties = schema.get("properties", {})
        for prop, value in tool_input.items():
            if prop in properties:
                prop_schema = properties[prop]
                expected_type = prop_schema.get("type")
                if expected_type and not self._check_type(value, expected_type):
                    errors.append(
                        f"Property '{prop}' has wrong type: "
                        f"expected {expected_type}, got {type(value).__name__}"
                    )

        return errors

    def _check_type(self, value: Any, expected_type: str) -> bool:
        """Check if a value matches an expected JSON schema type."""
        type_map = {
            "string": str,
            "number": (int, float),
            "integer": int,
            "boolean": bool,
            "array": list,
            "object": dict,
            "null": type(None),
        }
        expected = type_map.get(expected_type)
        if expected is None:
            return True  # Unknown type, skip check
        return isinstance(value, expected)
