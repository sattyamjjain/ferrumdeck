"""Tests for MCP router."""

import pytest

from fd_mcp_router.config import MCPServerConfig, ToolAllowlist
from fd_mcp_router.router import MCPRouter, ServerConnection, ToolInfo, ToolResult


# ==========================================================================
# MCP-RTR-001: ToolInfo dataclass
# ==========================================================================
class TestToolInfo:
    """Tests for ToolInfo dataclass."""

    def test_tool_info_creation(self) -> None:
        """Test creating ToolInfo."""
        info = ToolInfo(
            name="read_file",
            server_name="fs-server",
            description="Read contents of a file",
            input_schema={
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
            },
        )
        assert info.name == "read_file"
        assert info.server_name == "fs-server"
        assert info.description == "Read contents of a file"
        assert "path" in info.input_schema["properties"]

    def test_tool_info_empty_schema(self) -> None:
        """Test ToolInfo with empty schema."""
        info = ToolInfo(
            name="ping",
            server_name="test",
            description="Simple ping",
            input_schema={},
        )
        assert info.input_schema == {}


# ==========================================================================
# MCP-RTR-002: ToolResult dataclass
# ==========================================================================
class TestToolResult:
    """Tests for ToolResult dataclass."""

    def test_tool_result_success(self) -> None:
        """Test successful ToolResult."""
        result = ToolResult(
            success=True,
            output={"content": "Hello World"},
            server="fs-server",
            tool="read_file",
        )
        assert result.success is True
        assert result.output == {"content": "Hello World"}
        assert result.error is None
        assert result.server == "fs-server"
        assert result.tool == "read_file"

    def test_tool_result_failure(self) -> None:
        """Test failed ToolResult."""
        result = ToolResult(
            success=False,
            output=None,
            error="File not found",
            server="fs-server",
            tool="read_file",
        )
        assert result.success is False
        assert result.output is None
        assert result.error == "File not found"

    def test_tool_result_defaults(self) -> None:
        """Test ToolResult defaults."""
        result = ToolResult(success=True, output="data")
        assert result.error is None
        assert result.server is None
        assert result.tool is None


# ==========================================================================
# MCP-RTR-003: ServerConnection dataclass
# ==========================================================================
class TestServerConnection:
    """Tests for ServerConnection dataclass."""

    def test_server_connection_creation(self) -> None:
        """Test creating ServerConnection."""
        config = MCPServerConfig(name="test", command="python")
        conn = ServerConnection(config=config)

        assert conn.config == config
        assert conn.session is None
        assert conn.tools == []
        assert conn.connected is False

    def test_server_connection_with_tools(self) -> None:
        """Test ServerConnection with tools."""
        config = MCPServerConfig(name="test", command="python")
        tools = [
            ToolInfo(name="tool1", server_name="test", description="", input_schema={}),
            ToolInfo(name="tool2", server_name="test", description="", input_schema={}),
        ]
        conn = ServerConnection(config=config, tools=tools, connected=True)

        assert len(conn.tools) == 2
        assert conn.connected is True


# ==========================================================================
# MCP-RTR-004: MCPRouter initialization
# ==========================================================================
class TestMCPRouterInit:
    """Tests for MCPRouter initialization."""

    def test_router_empty_init(self) -> None:
        """Test creating router with no config."""
        router = MCPRouter()
        assert router.servers == {}
        assert router.allowlist.allowed_tools == []

    def test_router_with_servers(self) -> None:
        """Test creating router with server configs."""
        servers = [
            MCPServerConfig(name="git", command="python"),
            MCPServerConfig(name="fs", command="node"),
        ]
        router = MCPRouter(servers=servers)

        assert "git" in router.servers
        assert "fs" in router.servers
        assert router.servers["git"].command == "python"

    def test_router_with_allowlist(self) -> None:
        """Test creating router with allowlist."""
        allowlist = ToolAllowlist(allowed_tools=["read_file", "write_file"])
        router = MCPRouter(allowlist=allowlist)

        assert router.allowlist.check("read_file") == "allowed"
        assert router.allowlist.check("unknown") == "denied"


# ==========================================================================
# MCP-RTR-005: Tool input validation
# ==========================================================================
class TestMCPRouterValidation:
    """Tests for MCPRouter input validation."""

    def test_validate_unknown_tool(self) -> None:
        """Test validating input for unknown tool."""
        router = MCPRouter()
        errors = router.validate_tool_input("unknown_tool", {})
        assert len(errors) == 1
        assert "Unknown tool" in errors[0]

    def test_validate_missing_required(self) -> None:
        """Test validation catches missing required fields."""
        router = MCPRouter()

        # Manually add a tool to the router for testing
        config = MCPServerConfig(name="test", command="python")
        tool_info = ToolInfo(
            name="read_file",
            server_name="test",
            description="Read file",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "encoding": {"type": "string"},
                },
                "required": ["path"],
            },
        )
        conn = ServerConnection(config=config, tools=[tool_info])
        router._connections["test"] = conn
        router._tool_to_server["read_file"] = "test"

        # Missing required field
        errors = router.validate_tool_input("read_file", {"encoding": "utf-8"})
        assert any("Missing required property: path" in e for e in errors)

    def test_validate_correct_input(self) -> None:
        """Test validation passes for correct input."""
        router = MCPRouter()

        # Set up a tool
        config = MCPServerConfig(name="test", command="python")
        tool_info = ToolInfo(
            name="read_file",
            server_name="test",
            description="Read file",
            input_schema={
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
            },
        )
        conn = ServerConnection(config=config, tools=[tool_info])
        router._connections["test"] = conn
        router._tool_to_server["read_file"] = "test"

        errors = router.validate_tool_input("read_file", {"path": "/tmp/test.txt"})
        assert errors == []

    def test_validate_wrong_type(self) -> None:
        """Test validation catches wrong types."""
        router = MCPRouter()

        config = MCPServerConfig(name="test", command="python")
        tool_info = ToolInfo(
            name="set_count",
            server_name="test",
            description="Set count",
            input_schema={
                "type": "object",
                "properties": {"count": {"type": "integer"}},
                "required": ["count"],
            },
        )
        conn = ServerConnection(config=config, tools=[tool_info])
        router._connections["test"] = conn
        router._tool_to_server["set_count"] = "test"

        # String instead of integer
        errors = router.validate_tool_input("set_count", {"count": "not_a_number"})
        assert any("wrong type" in e for e in errors)


# ==========================================================================
# MCP-RTR-006: Type checking
# ==========================================================================
class TestTypeChecking:
    """Tests for _check_type method."""

    def test_check_type_string(self) -> None:
        """Test string type check."""
        router = MCPRouter()
        assert router._check_type("hello", "string") is True
        assert router._check_type(123, "string") is False

    def test_check_type_number(self) -> None:
        """Test number type check."""
        router = MCPRouter()
        assert router._check_type(123, "number") is True
        assert router._check_type(3.14, "number") is True
        assert router._check_type("123", "number") is False

    def test_check_type_integer(self) -> None:
        """Test integer type check."""
        router = MCPRouter()
        assert router._check_type(123, "integer") is True
        assert router._check_type(3.14, "integer") is False

    def test_check_type_boolean(self) -> None:
        """Test boolean type check."""
        router = MCPRouter()
        assert router._check_type(True, "boolean") is True
        assert router._check_type(False, "boolean") is True
        assert router._check_type(1, "boolean") is False

    def test_check_type_array(self) -> None:
        """Test array type check."""
        router = MCPRouter()
        assert router._check_type([1, 2, 3], "array") is True
        assert router._check_type([], "array") is True
        assert router._check_type("not array", "array") is False

    def test_check_type_object(self) -> None:
        """Test object type check."""
        router = MCPRouter()
        assert router._check_type({"key": "value"}, "object") is True
        assert router._check_type({}, "object") is True
        assert router._check_type([1, 2], "object") is False

    def test_check_type_null(self) -> None:
        """Test null type check."""
        router = MCPRouter()
        assert router._check_type(None, "null") is True
        assert router._check_type("not null", "null") is False

    def test_check_type_unknown(self) -> None:
        """Test unknown type always passes."""
        router = MCPRouter()
        assert router._check_type("anything", "custom_type") is True


# ==========================================================================
# MCP-RTR-007: Tool listing methods
# ==========================================================================
class TestMCPRouterListing:
    """Tests for tool listing methods."""

    def test_get_tool_info_not_found(self) -> None:
        """Test getting info for unknown tool."""
        router = MCPRouter()
        assert router.get_tool_info("unknown") is None

    def test_get_tool_info_found(self) -> None:
        """Test getting info for known tool."""
        router = MCPRouter()

        config = MCPServerConfig(name="test", command="python")
        tool_info = ToolInfo(
            name="my_tool",
            server_name="test",
            description="My tool",
            input_schema={"type": "object"},
        )
        conn = ServerConnection(config=config, tools=[tool_info])
        router._connections["test"] = conn
        router._tool_to_server["my_tool"] = "test"

        info = router.get_tool_info("my_tool")
        assert info is not None
        assert info.name == "my_tool"
        assert info.description == "My tool"

    def test_list_all_discovered_tools(self) -> None:
        """Test listing all discovered tools."""
        router = MCPRouter()

        # Add tools from multiple servers
        config1 = MCPServerConfig(name="server1", command="python")
        config2 = MCPServerConfig(name="server2", command="python")

        tools1 = [
            ToolInfo(name="tool1", server_name="server1", description="", input_schema={}),
            ToolInfo(name="tool2", server_name="server1", description="", input_schema={}),
        ]
        tools2 = [
            ToolInfo(name="tool3", server_name="server2", description="", input_schema={}),
        ]

        router._connections["server1"] = ServerConnection(config=config1, tools=tools1)
        router._connections["server2"] = ServerConnection(config=config2, tools=tools2)

        all_tools = router.list_all_discovered_tools()
        assert len(all_tools) == 3
        tool_names = {t.name for t in all_tools}
        assert tool_names == {"tool1", "tool2", "tool3"}

    def test_list_available_tools(self) -> None:
        """Test listing only allowed tools."""
        allowlist = ToolAllowlist(allowed_tools=["tool1", "tool3"])
        router = MCPRouter(allowlist=allowlist)

        config = MCPServerConfig(name="test", command="python")
        tools = [
            ToolInfo(name="tool1", server_name="test", description="", input_schema={}),
            ToolInfo(name="tool2", server_name="test", description="", input_schema={}),
            ToolInfo(name="tool3", server_name="test", description="", input_schema={}),
        ]
        conn = ServerConnection(config=config, tools=tools)
        router._connections["test"] = conn
        for tool in tools:
            router._tool_to_server[tool.name] = "test"

        available = router.list_available_tools()
        assert len(available) == 2
        names = {t.name for t in available}
        assert names == {"tool1", "tool3"}


# ==========================================================================
# MCP-RTR-008: Policy enforcement in call_tool
# ==========================================================================
class TestMCPRouterPolicyEnforcement:
    """Tests for policy enforcement during tool calls."""

    @pytest.mark.asyncio
    async def test_call_tool_denied(self) -> None:
        """Test that denied tools raise PermissionError."""
        router = MCPRouter(
            allowlist=ToolAllowlist(
                allowed_tools=["safe_tool"],
                denied_tools=["dangerous_tool"],
            )
        )

        with pytest.raises(PermissionError) as exc_info:
            await router.call_tool("dangerous_tool", {})

        assert "not in the allowlist" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_call_tool_not_in_allowlist(self) -> None:
        """Test that tools not in allowlist are denied by default."""
        router = MCPRouter(allowlist=ToolAllowlist(allowed_tools=["tool1"]))

        with pytest.raises(PermissionError):
            await router.call_tool("unknown_tool", {})

    @pytest.mark.asyncio
    async def test_call_tool_requires_approval(self) -> None:
        """Test that tools requiring approval raise ValueError."""
        router = MCPRouter(allowlist=ToolAllowlist(approval_required=["sensitive_tool"]))

        with pytest.raises(ValueError) as exc_info:
            await router.call_tool("sensitive_tool", {})

        assert "requires approval" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_call_tool_no_server(self) -> None:
        """Test calling tool when no server provides it."""
        router = MCPRouter(allowlist=ToolAllowlist(allowed_tools=["orphan_tool"]))

        result = await router.call_tool("orphan_tool", {})
        assert result.success is False
        assert "No server found" in (result.error or "")
