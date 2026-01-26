# fd-worker

<!-- AUTO-MANAGED: module-description -->
## Purpose

Queue worker that executes agent steps. Consumes jobs from Redis, executes LLM calls and tool invocations, and reports results back to the control plane.

**Role**: Execution engine - the actual work of running agent steps happens here.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: architecture -->
## Module Architecture

```
fd-worker/src/fd_worker/
├── __init__.py       # Package exports
├── __main__.py       # Entry point (python -m fd_worker)
├── main.py           # Worker initialization and loop
├── queue.py          # Redis queue consumer (XREAD)
├── executor.py       # Step execution orchestration
├── llm.py            # LLM calls via litellm
├── agentic.py        # Agentic loop execution
├── validation.py     # Output validation (LLM02 mitigation)
└── exceptions.py     # Worker-specific exceptions
```

**Execution Flow**:
```
Redis Queue → Queue Consumer → Executor
                                  ├── LLM Step → litellm → Claude/GPT
                                  ├── Tool Step → MCP Router → MCP Server
                                  └── Validation → Output checks
                              → Report Result → Gateway API
```

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: conventions -->
## Module-Specific Conventions

### Step Execution
```python
async def execute_step(job: StepJob) -> StepResult:
    match job.step_type:
        case "LLM":
            return await execute_llm(job)
        case "TOOL":
            return await execute_tool(job)
```

### LLM Calls
```python
from litellm import acompletion

response = await acompletion(
    model=job.model,
    messages=job.messages,
    max_tokens=job.max_tokens,
)
```

### Error Handling
- Transient errors: Retry with exponential backoff
- Policy violations: Report as step failure
- LLM errors: Capture and report with context

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: dependencies -->
## Key Dependencies

| Package | Purpose |
|---------|---------|
| `fd-runtime` | Shared models and tracing |
| `fd-mcp-router` | Tool execution routing |
| `redis` | Queue communication |
| `litellm` | Multi-provider LLM calls |
| `tenacity` | Retry with backoff |
| `opentelemetry` | Distributed tracing |

<!-- END AUTO-MANAGED -->

<!-- MANUAL -->
## Running the Worker

```bash
# Via make
make run-worker

# Directly
uv run python -m fd_worker

# With debug logging
PYTHONUNBUFFERED=1 LOG_LEVEL=DEBUG uv run python -m fd_worker
```

## Environment Variables

```bash
REDIS_URL=redis://localhost:6379
GATEWAY_URL=http://localhost:8080
ANTHROPIC_API_KEY=sk-ant-...
```

## LLM02 Output Validation

The `validation.py` module implements OWASP LLM02 mitigations:
- Schema validation of tool arguments
- Boundary checks on numeric values
- Injection pattern detection

<!-- END MANUAL -->
