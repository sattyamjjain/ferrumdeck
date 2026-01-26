# fd-mcp-tools

<!-- AUTO-MANAGED: module-description -->
## Purpose

MCP server implementations for built-in tools. Provides Git operations and test runner capabilities as MCP servers.

**Role**: Tool implementations - actual tool logic executed by the worker.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: architecture -->
## Module Architecture

```
fd-mcp-tools/src/fd_mcp_tools/
├── __init__.py              # Package exports
├── git_server.py            # Git operations MCP server
└── test_runner_server.py    # Test execution MCP server
```

**Available Tools**:
- `git.status` - Repository status
- `git.diff` - Show changes
- `git.commit` - Create commit
- `git.branch` - Branch operations
- `test.run` - Execute test suite
- `test.list` - List available tests

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: conventions -->
## Module-Specific Conventions

### MCP Server Pattern
```python
from mcp.server import Server
from mcp.types import Tool, TextContent

server = Server("git-server")

@server.list_tools()
async def list_tools() -> list[Tool]:
    return [Tool(name="git.status", ...)]

@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    if name == "git.status":
        return [TextContent(type="text", text=run_git_status())]
```

### Running Servers
```bash
# Git server
fd-mcp-git

# Test runner server
fd-mcp-test-runner
```

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: dependencies -->
## Key Dependencies

| Package | Purpose |
|---------|---------|
| `mcp` | MCP server framework |

<!-- END AUTO-MANAGED -->

<!-- MANUAL -->
## External MCP Servers

For GitHub operations, use the official GitHub MCP server:
```bash
npx -y @anthropic-ai/github-mcp-server
```

This provides `github.create_pr`, `github.review`, etc.

## Adding New Tools

1. Create tool function:
```python
def my_tool(arg: str) -> str:
    return f"Result: {arg}"
```

2. Register with server:
```python
@server.list_tools()
async def list_tools():
    return [Tool(name="my.tool", inputSchema={...})]

@server.call_tool()
async def call_tool(name, args):
    if name == "my.tool":
        return [TextContent(type="text", text=my_tool(args["arg"]))]
```

3. Add entry point in `pyproject.toml`:
```toml
[project.scripts]
fd-mcp-my-tool = "fd_mcp_tools.my_server:main"
```

<!-- END MANUAL -->
