"""Tests for MCP router configuration."""

from fd_mcp_router.config import MCPServerConfig, ToolAllowlist


# ==========================================================================
# MCP-CFG-001: MCPServerConfig model
# ==========================================================================
class TestMCPServerConfig:
    """Tests for MCPServerConfig model."""

    def test_server_config_minimal(self) -> None:
        """Test creating config with minimal fields."""
        config = MCPServerConfig(name="test-server")
        assert config.name == "test-server"
        assert config.command is None
        assert config.url is None
        assert config.args is None
        assert config.env is None

    def test_server_config_with_command(self) -> None:
        """Test creating config with command."""
        config = MCPServerConfig(
            name="git-server",
            command="python",
            args=["-m", "fd_mcp_tools.git_server"],
        )
        assert config.name == "git-server"
        assert config.command == "python"
        assert config.args == ["-m", "fd_mcp_tools.git_server"]

    def test_server_config_with_url(self) -> None:
        """Test creating config with URL."""
        config = MCPServerConfig(
            name="remote-server",
            url="http://localhost:8081/mcp",
        )
        assert config.name == "remote-server"
        assert config.url == "http://localhost:8081/mcp"

    def test_server_config_with_env(self) -> None:
        """Test creating config with environment variables."""
        config = MCPServerConfig(
            name="env-server",
            command="node",
            args=["server.js"],
            env={"API_KEY": "secret", "DEBUG": "true"},
        )
        assert config.env is not None
        assert config.env["API_KEY"] == "secret"
        assert config.env["DEBUG"] == "true"

    def test_server_config_serialization(self) -> None:
        """Test config serialization."""
        config = MCPServerConfig(
            name="test",
            command="python",
            args=["-m", "server"],
        )
        data = config.model_dump()
        assert data["name"] == "test"
        assert data["command"] == "python"
        assert data["args"] == ["-m", "server"]


# ==========================================================================
# MCP-CFG-002: ToolAllowlist check method
# ==========================================================================
class TestToolAllowlist:
    """Tests for ToolAllowlist model."""

    def test_allowlist_defaults(self) -> None:
        """Test allowlist with default values."""
        allowlist = ToolAllowlist()
        assert allowlist.allowed_tools == []
        assert allowlist.approval_required == []
        assert allowlist.denied_tools == []

    def test_allowlist_allowed_tool(self) -> None:
        """Test checking an allowed tool."""
        allowlist = ToolAllowlist(
            allowed_tools=["read_file", "write_file", "list_dir"],
        )
        assert allowlist.check("read_file") == "allowed"
        assert allowlist.check("write_file") == "allowed"
        assert allowlist.check("list_dir") == "allowed"

    def test_allowlist_denied_tool(self) -> None:
        """Test checking an explicitly denied tool."""
        allowlist = ToolAllowlist(
            denied_tools=["execute_shell", "delete_all"],
        )
        assert allowlist.check("execute_shell") == "denied"
        assert allowlist.check("delete_all") == "denied"

    def test_allowlist_approval_required(self) -> None:
        """Test checking a tool requiring approval."""
        allowlist = ToolAllowlist(
            approval_required=["create_pr", "deploy_production"],
        )
        assert allowlist.check("create_pr") == "requires_approval"
        assert allowlist.check("deploy_production") == "requires_approval"

    def test_allowlist_deny_by_default(self) -> None:
        """Test that unknown tools are denied by default."""
        allowlist = ToolAllowlist(
            allowed_tools=["read_file"],
        )
        assert allowlist.check("unknown_tool") == "denied"
        assert allowlist.check("another_unknown") == "denied"

    def test_allowlist_priority_denied(self) -> None:
        """Test that denied takes priority."""
        allowlist = ToolAllowlist(
            allowed_tools=["dangerous_tool"],
            denied_tools=["dangerous_tool"],
        )
        # Denied takes priority over allowed
        assert allowlist.check("dangerous_tool") == "denied"

    def test_allowlist_priority_approval_over_allowed(self) -> None:
        """Test that approval_required takes priority over allowed."""
        allowlist = ToolAllowlist(
            allowed_tools=["sensitive_tool"],
            approval_required=["sensitive_tool"],
        )
        # Should check denied first, then approval, then allowed
        # Since approval is checked before allowed:
        assert allowlist.check("sensitive_tool") == "requires_approval"

    def test_allowlist_empty_denies_all(self) -> None:
        """Test that empty allowlist denies all tools."""
        allowlist = ToolAllowlist()
        assert allowlist.check("any_tool") == "denied"
        assert allowlist.check("read_file") == "denied"

    def test_allowlist_serialization(self) -> None:
        """Test allowlist serialization."""
        allowlist = ToolAllowlist(
            allowed_tools=["read", "write"],
            approval_required=["delete"],
            denied_tools=["rm_rf"],
        )
        data = allowlist.model_dump()
        assert data["allowed_tools"] == ["read", "write"]
        assert data["approval_required"] == ["delete"]
        assert data["denied_tools"] == ["rm_rf"]


# ==========================================================================
# MCP-CFG-003: Configuration composition
# ==========================================================================
class TestConfigurationComposition:
    """Tests for combining configs."""

    def test_multiple_server_configs(self) -> None:
        """Test creating multiple server configs."""
        configs = [
            MCPServerConfig(name="git", command="python", args=["-m", "git_server"]),
            MCPServerConfig(name="fs", command="python", args=["-m", "fs_server"]),
            MCPServerConfig(name="remote", url="http://localhost:9000"),
        ]

        assert len(configs) == 3
        assert configs[0].name == "git"
        assert configs[1].name == "fs"
        assert configs[2].url == "http://localhost:9000"

    def test_config_dict_conversion(self) -> None:
        """Test creating config from dict."""
        data = {
            "name": "test-server",
            "command": "node",
            "args": ["index.js"],
            "env": {"PORT": "3000"},
        }
        config = MCPServerConfig(**data)
        assert config.name == "test-server"
        assert config.command == "node"
        assert config.env is not None
        assert config.env["PORT"] == "3000"

    def test_allowlist_from_dict(self) -> None:
        """Test creating allowlist from dict."""
        data = {
            "allowed_tools": ["tool1", "tool2"],
            "approval_required": ["tool3"],
            "denied_tools": ["tool4"],
        }
        allowlist = ToolAllowlist(**data)
        assert allowlist.check("tool1") == "allowed"
        assert allowlist.check("tool3") == "requires_approval"
        assert allowlist.check("tool4") == "denied"
