# fd-otel

<!-- AUTO-MANAGED: module-description -->
## Purpose

OpenTelemetry setup and helpers for FerrumDeck. Provides distributed tracing with GenAI semantic conventions for LLM observability.

**Role**: Observability foundation - all services emit traces through this crate.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: architecture -->
## Module Architecture

```
fd-otel/src/
├── lib.rs          # Public exports and setup
├── setup.rs        # OTEL initialization
└── genai.rs        # GenAI semantic conventions
```

**Tracing Flow**:
```
Gateway/Worker → OpenTelemetry SDK → OTLP Exporter → Jaeger
```

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: conventions -->
## Module-Specific Conventions

### Initialization
```rust
use fd_otel::setup_tracing;

#[tokio::main]
async fn main() {
    setup_tracing("gateway").await;
    // ... rest of app
}
```

### GenAI Attributes
```rust
// Per OpenTelemetry GenAI semantic conventions
span.set_attribute("gen_ai.system", "anthropic");
span.set_attribute("gen_ai.request.model", "claude-3-opus");
span.set_attribute("gen_ai.usage.input_tokens", tokens);
```

### Span Naming
- `run.execute` - Full run execution
- `step.execute` - Individual step
- `llm.complete` - LLM API call
- `tool.invoke` - Tool execution

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: dependencies -->
## Key Dependencies

| Crate | Purpose |
|-------|---------|
| `opentelemetry` | Core OTEL API |
| `opentelemetry_sdk` | SDK implementation |
| `opentelemetry-otlp` | OTLP exporter |
| `tracing-opentelemetry` | Tracing integration |

<!-- END AUTO-MANAGED -->

<!-- MANUAL -->
## Viewing Traces

```bash
# Start Jaeger
make dev-up

# Open Jaeger UI
open http://localhost:16686
```

## Environment Variables

```bash
JAEGER_ENDPOINT=http://localhost:4317  # OTLP endpoint
OTEL_SERVICE_NAME=gateway              # Service name
```

<!-- END MANUAL -->
