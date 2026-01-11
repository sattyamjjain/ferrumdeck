# Python Data Plane

<!-- AUTO-MANAGED: module-description -->
## Purpose

The Python workspace implements the **Data Plane** for FerrumDeck - the execution layer that runs agent steps. It handles LLM calls, tool execution via MCP, and step orchestration with full observability.

**Role**: Stateless workers that consume jobs from Redis queue, execute steps, and report results back to the control plane.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: architecture -->
## Module Architecture

```
python/packages/
├── fd-runtime/               # Core runtime library
│   └── src/fd_runtime/
│       ├── models.py         # Shared data models
│       ├── workflow.py       # Workflow execution
│       ├── client.py         # Control plane client
│       ├── tracing.py        # OpenTelemetry helpers
│       └── artifacts.py      # Artifact storage
├── fd-worker/                # Queue worker
│   └── src/fd_worker/
│       ├── __main__.py       # Entry point
│       ├── main.py           # Worker initialization
│       ├── queue.py          # Redis queue consumer
│       ├── executor.py       # Step execution logic
│       ├── llm.py            # LLM executor (litellm)
│       └── validation.py     # Output validation (LLM02)
├── fd-mcp-router/            # MCP tool routing
│   └── src/fd_mcp_router/
│       ├── router.py         # Tool routing logic
│       └── config.py         # Server configuration
├── fd-mcp-tools/             # MCP server implementations
│   └── src/fd_mcp_tools/
│       ├── git_server.py     # Git operations
│       └── test_runner_server.py  # Test execution
├── fd-evals/                 # Evaluation framework
│   └── src/fd_evals/
│       ├── __main__.py       # CLI entry point
│       ├── runner.py         # Eval runner
│       ├── suite.py          # Test suites
│       ├── task.py           # Task definitions
│       ├── scorer.py         # Scoring interface
│       └── scorers/          # Built-in scorers
└── fd-cli/                   # CLI tool
    └── src/fd_cli/
        └── main.py           # CLI commands
```

**Step Types**:
- `LLM` - Call LLM via litellm (Claude, GPT, etc.)
- `TOOL` - Execute MCP tool with policy check
- `RETRIEVAL` - Vector search operations
- `SANDBOX` - Isolated code execution
- `APPROVAL` - Human approval gates

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: conventions -->
## Module-Specific Conventions

### Package Structure
- Each package uses `src/fd_<name>/` layout
- Entry point in `__init__.py` with public exports
- Tests in `tests/` subdirectory
- CLI modules use `__main__.py`

### Async Patterns
```python
# Use asyncio throughout
async def execute_step(job: dict[str, Any]) -> None:
    async with trace_step_execution(...) as span:
        result = await self._execute_llm(...)
```

### Type Hints
```python
# Modern Python 3.12+ syntax
def process(items: list[str]) -> dict[str, Any]:
    ...

# Use | for optionals
def create(name: str, config: Config | None = None):
    ...
```

### Error Handling
```python
# Specific exceptions for policy decisions
raise PermissionError("Tool denied by policy")
raise ValueError("Tool requires approval")
```

### Tracing
```python
# Use context managers for spans
with trace_llm_call(model=model, run_id=run_id) as span:
    response = await llm.complete(...)
    set_llm_response_attributes(span, ...)
```

### Testing
```bash
# Run specific package tests
uv run pytest python/packages/fd-worker/tests/ -v
uv run pytest python/packages/fd-evals/tests/ -v

# Run with coverage
uv run pytest --cov=fd_worker
```

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: dependencies -->
## Key Dependencies

| Package | Purpose |
|---------|---------|
| `litellm` | Unified LLM interface |
| `httpx` | Async HTTP client |
| `tenacity` | Retry with backoff |
| `pydantic` | Data validation |
| `opentelemetry` | Distributed tracing |
| `redis` | Queue communication |
| `mcp` | Model Context Protocol |
| `pytest-asyncio` | Async test support |
| `ruff` | Linting + formatting |
| `pyright` | Type checking |

<!-- END AUTO-MANAGED -->

<!-- MANUAL -->
## MCP Tool Integration

### How MCP Routing Works
1. Worker receives `TOOL` step from queue
2. MCP Router checks policy engine (via gateway API)
3. If allowed, routes to appropriate MCP server
4. Server executes tool and returns result
5. Result is validated and sent back to control plane

### Adding a New MCP Server
```python
# 1. Create server file in fd-mcp-tools
# python/packages/fd-mcp-tools/src/fd_mcp_tools/my_server.py

from mcp.server import Server
from mcp.types import Tool, TextContent

server = Server("my-server")

@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="my_tool",
            description="Does something useful",
            inputSchema={
                "type": "object",
                "properties": {
                    "arg": {"type": "string"}
                },
                "required": ["arg"]
            }
        )
    ]

@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    if name == "my_tool":
        result = do_something(arguments["arg"])
        return [TextContent(type="text", text=result)]
    raise ValueError(f"Unknown tool: {name}")
```

### Registering Tools with Gateway
Tools must be registered in the gateway's tool registry:
```bash
curl -X POST http://localhost:8080/api/v1/tools \
  -H "Authorization: Bearer $FD_API_KEY" \
  -d '{"name": "my_tool", "server": "my-server", "schema": {...}}'
```

## OpenTelemetry Tracing

### Setting Up Traces
```python
from opentelemetry import trace
from fd_runtime.tracing import setup_tracing

# Initialize at startup
setup_tracing(service_name="fd-worker")

tracer = trace.get_tracer(__name__)
```

### Creating Spans
```python
# Basic span
with tracer.start_as_current_span("operation_name") as span:
    span.set_attribute("custom.attribute", "value")
    result = do_work()

# Async context manager
async with trace_llm_call(model="claude-3-opus", run_id=run_id):
    response = await complete(...)
```

### GenAI Semantic Conventions
```python
# LLM call attributes (per OpenTelemetry GenAI spec)
span.set_attribute("gen_ai.system", "anthropic")
span.set_attribute("gen_ai.request.model", "claude-3-opus")
span.set_attribute("gen_ai.usage.input_tokens", token_count)
span.set_attribute("gen_ai.usage.output_tokens", completion_tokens)
```

### Viewing Traces
```bash
# Open Jaeger UI
open http://localhost:16686

# Filter by service: fd-worker
# Search by trace ID from logs
```

## LLM Provider Configuration

### Supported Providers (via litellm)
- Anthropic (Claude models)
- OpenAI (GPT models)
- Azure OpenAI
- AWS Bedrock

### Configuration
```python
# litellm auto-detects from env vars
# ANTHROPIC_API_KEY for Claude
# OPENAI_API_KEY for GPT

from litellm import completion

response = await completion(
    model="claude-3-opus-20240229",
    messages=[{"role": "user", "content": "Hello"}],
    max_tokens=1000
)
```

### Fallback Configuration
```python
# litellm supports fallback models
response = await completion(
    model="claude-3-opus-20240229",
    fallbacks=["gpt-4", "claude-3-sonnet"],
    messages=[...]
)
```

## Adding a New Package

1. Create package structure:
   ```bash
   mkdir -p python/packages/fd-newpkg/src/fd_newpkg
   mkdir python/packages/fd-newpkg/tests
   ```

2. Create `pyproject.toml`:
   ```toml
   [project]
   name = "fd-newpkg"
   version = "0.1.0"
   requires-python = ">=3.12"
   dependencies = [
       "fd-runtime",
   ]

   [build-system]
   requires = ["hatchling"]
   build-backend = "hatchling.build"

   [tool.hatch.build.targets.wheel]
   packages = ["src/fd_newpkg"]
   ```

3. Create `src/fd_newpkg/__init__.py`:
   ```python
   """Brief description of package."""
   from .main import main_function

   __all__ = ["main_function"]
   ```

4. Add to workspace in root `pyproject.toml`:
   ```toml
   [tool.uv.workspace]
   members = [
       "python/packages/fd-newpkg",
       # ...
   ]
   ```

5. Sync dependencies:
   ```bash
   uv sync
   ```

## Debugging

### Enable Debug Logging
```python
import logging
logging.basicConfig(level=logging.DEBUG)

# Or per-module
logging.getLogger("fd_worker").setLevel(logging.DEBUG)
```

### Run Worker with Verbose Output
```bash
PYTHONUNBUFFERED=1 uv run python -m fd_worker 2>&1 | tee worker.log
```

### Interactive Debugging
```python
# Insert breakpoint
import pdb; pdb.set_trace()

# Or use ipdb for better experience
import ipdb; ipdb.set_trace()
```

### Common Issues

**ModuleNotFoundError**
```bash
# Ensure package is installed
uv sync

# Check it's in the workspace
uv pip list | grep fd-
```

**Redis Connection Failed**
```bash
# Check Redis is running
redis-cli ping

# Check connection URL
echo $REDIS_URL
```

**LLM API Errors**
```bash
# Verify API key is set
echo $ANTHROPIC_API_KEY

# Test with curl
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model": "claude-3-opus-20240229", "max_tokens": 10, "messages": [{"role": "user", "content": "Hi"}]}'
```

<!-- END MANUAL -->
