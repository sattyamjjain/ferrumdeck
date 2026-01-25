# AGENTS.md - AI Coding Agent Guidelines

## Quick Reference

```bash
# Essential commands
make check                # Format + lint + test (run before commits)
make dev-up               # Start infrastructure (Postgres, Redis, Jaeger)
make run-gateway          # Start Rust gateway (port 8080)
make run-worker           # Start Python worker
```

## Build & Test Commands

### Full Suite
```bash
make build                # Build all (Rust + Python)
make test                 # Run all tests
make lint                 # Lint all (clippy + ruff + pyright)
make fmt                  # Format all code
```

### Running Single Tests

**Rust:**
```bash
# Single test function
cargo test --package fd-policy test_tool_allowlist_allow

# Single test file/module
cargo test --package fd-policy --lib engine::tests

# Pattern matching
cargo test --workspace budget

# With output
cargo test --package fd-core -- --nocapture
```

**Python:**
```bash
# Single test file
uv run pytest python/packages/fd-worker/tests/test_executor.py -v

# Single test class
uv run pytest python/packages/fd-worker/tests/test_executor.py::TestLLMExecution -v

# Single test function
uv run pytest python/packages/fd-worker/tests/test_executor.py::TestLLMExecution::test_llm_execution_success -v

# Pattern matching
uv run pytest -k "sandbox" -v
```

**Next.js:**
```bash
cd nextjs && npm run lint    # ESLint
cd nextjs && npm run build   # Type check + build
```

### Linting Individual Languages
```bash
make lint-rust            # cargo clippy --workspace --all-targets -- -D warnings
make lint-python          # ruff check + pyright
make fmt-rust             # cargo fmt --all
make fmt-python           # ruff format python/
```

## Code Style Guidelines

### Rust (Edition 2021, MSRV 1.80)

**Naming:**
- Files: `snake_case.rs`
- Functions/methods: `snake_case`
- Types/Structs/Enums: `PascalCase`
- Constants: `SCREAMING_SNAKE_CASE`
- Crate prefix: `fd-` (e.g., `fd-core`, `fd-policy`)

**Error Handling:**
```rust
// Use thiserror for library errors
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("not found: {entity} with id {id}")]
    NotFound { entity: &'static str, id: String },
}

// Use anyhow for application errors in main/handlers
```

**Async & Tracing:**
```rust
#[instrument(skip(state), fields(run_id = %request.run_id))]
pub async fn handler(State(state): State<AppState>) -> Result<impl IntoResponse, ApiError> {
    // Use ? for error propagation
}
```

**ID Pattern:**
```rust
define_id!(RunId, "run");   // Generates run_01HGXK...
define_id!(StepId, "stp");  // Generates stp_01HGXK...
```

### Python (3.12+)

**Naming:**
- Files: `snake_case.py`
- Functions/variables: `snake_case`
- Classes: `PascalCase`
- Module prefix: `fd_` (e.g., `fd_runtime`, `fd_worker`)

**Formatting:** ruff (line-length 100)

**Import Order (isort via ruff):**
```python
# 1. Standard library
import asyncio
from pathlib import Path

# 2. Third-party
import httpx
from pydantic import BaseModel

# 3. First-party (fd_* packages)
from fd_runtime import trace_step_execution
from fd_worker.executor import StepExecutor
```

**Type Hints (modern syntax):**
```python
def process(items: list[str]) -> dict[str, Any]: ...
def create(name: str, config: Config | None = None) -> Run: ...
```

**Async Patterns:**
```python
async def execute_step(self, job: dict[str, Any]) -> None:
    async with httpx.AsyncClient() as client:
        response = await client.post(url, json=payload)
```

**Pydantic Models:**
```python
class Budget(BaseModel):
    max_input_tokens: int | None = 100_000
    max_cost_cents: int | None = 500
```

### TypeScript/Next.js (Next.js 16+, React 19)

**Naming:**
- Files: `kebab-case.tsx` or `kebab-case.ts`
- Functions: `camelCase`
- Components: `PascalCase`
- Types/Interfaces: `PascalCase`

**Component Pattern:**
```typescript
"use client";

import { useState } from "react";
import { useRun } from "@/hooks/use-runs";

interface Props {
  runId: string;
}

export function RunDetail({ runId }: Props) {
  const { data: run, isLoading } = useRun(runId);
  if (isLoading) return <LoadingPage />;
  return <div>...</div>;
}
```

**Styling (Tailwind CSS 4, dark theme):**
```typescript
import { cn } from "@/lib/utils";

<div className={cn(
  "px-3 py-2 rounded-lg transition-all",
  isActive ? "bg-accent-primary/10" : "hover:bg-background-tertiary/50"
)} />
```

**Path Alias:** Use `@/*` for imports from `./src/*`

## Architecture Overview

```
ferrumdeck/
├── rust/                     # Control Plane
│   ├── crates/               # fd-core, fd-storage, fd-policy, fd-audit, etc.
│   └── services/gateway/     # Axum HTTP API (port 8080)
├── python/packages/          # Data Plane
│   ├── fd-runtime/           # Workflow execution
│   ├── fd-worker/            # Queue consumer
│   ├── fd-mcp-router/        # MCP tool routing
│   └── fd-evals/             # Evaluation framework
├── nextjs/                   # Dashboard (port 3000)
└── evals/                    # Evaluation configs
```

## ID Prefixes

| Entity | Prefix | Example |
|--------|--------|---------|
| Run | `run` | `run_01HGXK...` |
| Step | `stp` | `stp_01HGXK...` |
| Agent | `agt` | `agt_01HGXK...` |
| Tool | `tol` | `tol_01HGXK...` |
| Policy | `pol` | `pol_01HGXK...` |

## Security Model

- **Deny-by-default**: All tools require explicit allowlist
- **Budget enforcement**: Runs killed when limits exceeded
- **Approval gates**: Sensitive actions require human approval

## Environment Variables

```bash
DATABASE_URL=postgres://ferrumdeck:ferrumdeck@localhost:5433/ferrumdeck
REDIS_URL=redis://localhost:6379
ANTHROPIC_API_KEY=sk-ant-...  # Required for LLM calls
```

## Common Workflows

```bash
# First-time setup
make install && make dev-up

# Development cycle
make dev-up               # Start infra
make run-gateway          # Terminal 1
make run-worker           # Terminal 2
# Edit code...
make check                # Before commit

# Database reset
make db-reset && make db-seed
```
