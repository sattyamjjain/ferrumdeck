# fd-mcp-router

<!-- AUTO-MANAGED: module-description -->
## Purpose

MCP (Model Context Protocol) tool router implementing deny-by-default execution. Routes tool calls to appropriate MCP servers after policy validation.

**Role**: Security gateway for tools - ensures all tool calls pass policy checks before execution.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: architecture -->
## Module Architecture

```
fd-mcp-router/src/fd_mcp_router/
├── __init__.py       # Package exports
├── router.py         # Main routing logic
└── config.py         # Server configuration
```

**Routing Flow**:
```
Tool Request → Router → Policy Check (Gateway API)
                           ↓
                     Allowed? → MCP Server → Result
                           ↓
                     Denied? → PermissionError
```

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: conventions -->
## Module-Specific Conventions

### Router Usage
```python
from fd_mcp_router import MCPRouter

router = MCPRouter(gateway_url="http://localhost:8080")
result = await router.call_tool(
    tool_name="github.create_pr",
    arguments={"repo": "org/repo", "title": "..."},
    run_id=run_id,
)
```

### Server Configuration
```python
# Servers are configured via Gateway registry
# Router discovers available servers dynamically
servers = await router.list_servers()
```

### Error Handling
- `PermissionError`: Tool denied by policy
- `ValueError`: Tool requires approval
- `ConnectionError`: MCP server unavailable

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: dependencies -->
## Key Dependencies

| Package | Purpose |
|---------|---------|
| `pydantic` | Configuration models |
| `mcp` | MCP protocol client |

<!-- END AUTO-MANAGED -->

<!-- MANUAL -->
## How Routing Works

1. Worker receives TOOL step with tool name
2. Router checks policy via Gateway API
3. If allowed, finds appropriate MCP server
4. Sends tool call via MCP protocol
5. Returns result or error to worker

## Adding New MCP Servers

MCP servers are registered in Gateway:
```bash
curl -X POST http://localhost:8080/api/v1/tools \
  -d '{"name": "my.tool", "server": "my-server", "schema": {...}}'
```

Router automatically discovers registered tools.

<!-- END MANUAL -->
