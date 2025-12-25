# ADR-0004: OpenTelemetry GenAI Semantic Conventions

## Status
Accepted

## Context
Observability is critical for understanding agent behavior, debugging issues, and optimizing costs. We need a tracing strategy that works with standard observability tools while capturing AI-specific metrics.

Requirements:
- Standard OpenTelemetry compatibility
- AI/LLM-specific attributes
- Cost tracking at span level
- Correlation across control/data plane
- Support for existing APM tools (Jaeger, Honeycomb, Datadog)

## Decision
We adopt the **OpenTelemetry GenAI Semantic Conventions** (draft) for all LLM-related spans.

### Span Naming
```
gen_ai.{operation}          # LLM operations
ferrumdeck.{operation}      # Platform operations
```

### Required Attributes

#### LLM Requests
| Attribute | Type | Example |
|-----------|------|---------|
| `gen_ai.system` | string | `anthropic` |
| `gen_ai.request.model` | string | `claude-sonnet-4-20250514` |
| `gen_ai.request.max_tokens` | int | `4096` |
| `gen_ai.request.temperature` | float | `0.7` |

#### LLM Responses
| Attribute | Type | Example |
|-----------|------|---------|
| `gen_ai.response.model` | string | `claude-sonnet-4-20250514` |
| `gen_ai.response.finish_reason` | string | `stop` |
| `gen_ai.usage.input_tokens` | int | `1500` |
| `gen_ai.usage.output_tokens` | int | `500` |

#### FerrumDeck Extensions
| Attribute | Type | Example |
|-----------|------|---------|
| `ferrumdeck.run.id` | string | `run_01J...` |
| `ferrumdeck.step.id` | string | `stp_01J...` |
| `ferrumdeck.step.type` | string | `llm` |
| `ferrumdeck.cost.cents` | int | `15` |
| `ferrumdeck.policy.decision` | string | `allow` |
| `ferrumdeck.tool.name` | string | `read_file` |

### Span Hierarchy
```
ferrumdeck.run
  ├── ferrumdeck.step (llm)
  │     └── gen_ai.chat
  ├── ferrumdeck.step (tool)
  │     └── ferrumdeck.tool_call
  └── ferrumdeck.step (llm)
        └── gen_ai.chat
```

### Trace Context Propagation
- W3C Trace Context headers between control/data plane
- `trace_id` and `span_id` stored in database for correlation

## Consequences

### Positive
- Standard-compliant, works with any OTel-compatible backend
- Future-proof as GenAI conventions mature
- Cost attribution at span granularity
- Easy correlation with platform traces

### Negative
- GenAI conventions are still draft
- Some attributes may change in future spec versions
- Additional span overhead for detailed tracing

### Configuration
```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
OTEL_SERVICE_NAME=ferrumdeck-gateway
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1  # 10% sampling in production
```

## Implementation

### Rust (Control Plane)
```rust
use fd_otel::genai;

let span = genai::create_llm_span("claude-sonnet-4-20250514")
    .with_max_tokens(4096)
    .with_temperature(0.7)
    .start();
```

### Python (Data Plane)
```python
from opentelemetry import trace
from fd_otel import genai_attributes

with tracer.start_as_current_span("gen_ai.chat") as span:
    span.set_attributes(genai_attributes(
        model="claude-sonnet-4-20250514",
        input_tokens=1500,
        output_tokens=500
    ))
```

## Alternatives Considered

### Custom Attributes Only
- Full control
- Rejected: Not compatible with GenAI tooling ecosystem

### LangSmith/Langfuse Native
- Rich AI-specific features
- Rejected: Vendor lock-in, want OTel compatibility

### No Tracing (Logs Only)
- Simpler
- Rejected: Can't correlate across services, poor debugging UX

## References
- [OTel GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [OTel Python SDK](https://opentelemetry.io/docs/languages/python/)
