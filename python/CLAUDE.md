# Python Data Plane

<!-- AUTO-MANAGED: module-description -->
## Purpose

The execution side. Workers pull steps off the Redis stream and actually run them — LLM completions via litellm,
tool calls routed through MCP — while every gating decision is delegated to the Rust control plane. Also home to
the evaluation and benchmark framework used to gate PRs.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: architecture -->
## Module Architecture

uv workspace rooted at the **repo root** `pyproject.toml` (members `python/packages/*`); internal packages are
wired through `[tool.uv.sources]` with `workspace = true`.

```
python/packages/
├── fd-runtime/      # models.py, client.py, workflow.py, tracing.py,
│                    #   airlock.py, artifacts.py, attestation.py
├── fd-worker/       # main.py, queue.py, executor.py, llm.py, agentic.py,
│                    #   validation.py (LLM02 output check), exceptions.py
├── fd-mcp-router/   # router.py, config.py
├── fd-mcp-tools/    # git_server.py, test_runner_server.py
├── fd-evals/        # runner.py, task.py, cli.py, suite.py, delta.py, replay.py
│   ├── scorers/     # base, code_quality, security, schema, files, pr, tests,
│   │                #   llm_judge, output_match
│   ├── asb.py · injection_defense.py · governed_benchmark.py   # offline, deterministic
│   ├── enforce_vs_observe.py · bench_audit.py · reversibility.py
│   ├── coherence.py · routing.py · promotion.py · harness{,_delta}.py
│   └── claim_grounding.py · cost_decomposition.py · firing_rate.py · training_signal.py
└── fd-cli/          # main.py (typer)
```

Package layout is `src/`-style: code lives in `python/packages/<pkg>/src/<module>/`, where the distribution name
uses hyphens (`fd-worker`) and the import module uses underscores (`fd_worker`).

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: conventions -->
## Module-Specific Conventions

- Python 3.12+. Use modern syntax: `X | None` over `Optional[X]`, builtin generics, `match` where it reads better.
- Async throughout — `asyncio`; pytest runs with `asyncio_mode="auto"`, so async tests need no decorator.
- Pydantic v2 models for anything crossing a boundary (queue payloads, API responses, eval task/report schemas).
- Format `ruff format` (line-length 100, target py312); lint `ruff check` + `pyright` in standard mode.
  Enabled rule families: E, W, F, I, B, C4, UP, ARG, SIM, TCH.
- First-party import group: `fd_runtime`, `fd_worker`, `fd_mcp_router`, `fd_evals`, `fd_cli`.
- Type hints on every function signature — pyright runs over all of `python/`.
- The worker never decides policy. It calls the gateway and enforces the returned decision; validate LLM output
  in `validation.py` *before* dispatching a tool.
- Governance evals must be deterministic and offline (no LLM, seeded) so they can gate PRs — see `asb.py`,
  `injection_defense.py`, `governed_benchmark.py`.
- **A suite's declared scorers are the ones that run.** `fd_evals.suite.load_suite()` resolves a suite to its
  dataset *plus* its `filter:`, `scorers:` and `settings:`. Register new scorers in `suite.SCORER_REGISTRY`;
  an unknown `type:` raises `SuiteError` rather than falling back. Silent substitution is why the safe-PR eval
  reported 0% for forty nightly runs without anyone being able to see why.
- **A scorer may only assert on what `run_context` actually carries.** `EvalRunner._build_run_context()` plus
  `_enrich_context_from_steps()` define that contract; `tool_calls` is a *list* of records (count is
  `tool_call_count`). Scorers reading keys the control plane never populates score 0 unconditionally and are
  listed in `suite.UNOBSERVABLE_SCORERS`.

```bash
# Run tests for one package
uv run pytest python/packages/fd-evals/tests/ -v

# Lint / typecheck the whole data plane
uv run ruff check python/ && uv run pyright python/
```

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: dependencies -->
## Key Dependencies

| Package | Depends on |
|---|---|
| `fd-runtime` | pydantic ≥2, httpx, opentelemetry-{api,sdk,exporter-otlp-proto-grpc} |
| `fd-worker` | fd-runtime, fd-mcp-router, redis ≥5, **litellm ≥1.84** (CVE floor), tenacity, opentelemetry |
| `fd-mcp-router` | pydantic ≥2, **mcp ≥1.28.1** (CVE floor) |
| `fd-mcp-tools` | mcp ≥1.28.1 |
| `fd-evals` | fd-runtime, httpx, jsonschema, pydantic, typer, rich, pyyaml, opentelemetry-sdk |
| `fd-cli` | fd-runtime, typer, rich, httpx |

Dev group (root `pyproject.toml`): pytest, pytest-asyncio, pytest-cov, ruff, pyright, pre-commit.

The `litellm` and `mcp` lower bounds are security floors, not conveniences — do not relax them.

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
