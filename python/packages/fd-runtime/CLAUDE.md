# fd-runtime

<!-- AUTO-MANAGED: module-description -->
## Purpose

Core runtime library shared across Python packages. Provides data models, control plane client, and OpenTelemetry tracing utilities.

**Role**: Foundation library - common types and utilities for all Python packages.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: architecture -->
## Module Architecture

```
fd-runtime/src/fd_runtime/
├── __init__.py       # Package exports
├── models.py         # Shared Pydantic models
├── workflow.py       # Workflow execution helpers
├── client.py         # Gateway API client
├── tracing.py        # OpenTelemetry setup
└── artifacts.py      # Artifact storage utilities
```

**Key Models**:
- `StepJob`: Job payload from queue
- `StepResult`: Execution result
- `RunState`: Current run status
- `AgentConfig`: Agent configuration

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: conventions -->
## Module-Specific Conventions

### Model Definitions
```python
from pydantic import BaseModel

class StepJob(BaseModel):
    step_id: str
    run_id: str
    step_type: Literal["LLM", "TOOL", "APPROVAL"]
    payload: dict[str, Any]
```

### Gateway Client
```python
from fd_runtime.client import GatewayClient

client = GatewayClient(base_url="http://localhost:8080")
run = await client.get_run(run_id)
await client.report_step_result(step_id, result)
```

### Tracing Setup
```python
from fd_runtime.tracing import setup_tracing

setup_tracing(service_name="fd-worker")
```

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: dependencies -->
## Key Dependencies

| Package | Purpose |
|---------|---------|
| `pydantic` | Data validation and models |
| `httpx` | Async HTTP client |
| `opentelemetry-*` | Distributed tracing |

<!-- END AUTO-MANAGED -->

<!-- MANUAL -->
## Usage in Other Packages

```python
# Import models
from fd_runtime.models import StepJob, StepResult

# Import client
from fd_runtime.client import GatewayClient

# Import tracing
from fd_runtime.tracing import setup_tracing, trace_span
```

<!-- END MANUAL -->
