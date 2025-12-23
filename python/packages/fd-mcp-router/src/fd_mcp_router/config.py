"""MCP router configuration."""

from pydantic import BaseModel


class MCPServerConfig(BaseModel):
    """Configuration for an MCP server."""

    name: str
    command: str | None = None
    url: str | None = None
    args: list[str] | None = None
    env: dict[str, str] | None = None


class ToolAllowlist(BaseModel):
    """Tool allowlist configuration."""

    allowed_tools: list[str] = []
    approval_required: list[str] = []
    denied_tools: list[str] = []

    def check(self, tool_name: str) -> str:
        """Check if a tool is allowed.

        Returns: "allowed", "requires_approval", or "denied"
        """
        if tool_name in self.denied_tools:
            return "denied"
        if tool_name in self.approval_required:
            return "requires_approval"
        if tool_name in self.allowed_tools:
            return "allowed"
        # Deny by default
        return "denied"
