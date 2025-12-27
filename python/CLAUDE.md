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
│       ├── main.py           # Entry point
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
│       ├── runner.py         # Eval runner
│       ├── suite.py          # Test suites
│       ├── task.py           # Task definitions
│       ├── scorer.py         # Scoring interface
│       └── scorers/          # Built-in scorers
├── fd-cli/                   # CLI tool
│   └── src/fd_cli/
│       └── main.py           # CLI commands
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
## Notes

<!-- END MANUAL -->
