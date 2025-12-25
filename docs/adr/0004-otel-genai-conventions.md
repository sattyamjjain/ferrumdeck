# ADR 0004: OpenTelemetry GenAI Semantic Conventions

## Status

Accepted

## Date

2024-12-26

## Context

FerrumDeck needs comprehensive observability for AI agent operations. Key requirements:

1. **Distributed tracing**: Track requests across Gateway → Worker → LLM providers
2. **Cost tracking**: Attribute token usage and costs to runs/tenants
3. **Performance monitoring**: Measure latency at each stage
4. **Debugging**: Correlate errors with specific LLM calls
5. **Compliance**: Log all AI operations for audit purposes

OpenTelemetry (OTel) is the emerging standard for observability. The OTel community has proposed semantic conventions specifically for Generative AI operations.

## Decision

We adopt **OpenTelemetry Semantic Conventions for GenAI** (experimental) with custom extensions for FerrumDeck-specific metrics.

### Standard GenAI Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `gen_ai.system` | string | "anthropic", "openai", etc. |
| `gen_ai.request.model` | string | Model identifier |
| `gen_ai.request.max_tokens` | int | Max tokens requested |
| `gen_ai.request.temperature` | float | Sampling temperature |
| `gen_ai.response.model` | string | Actual model used |
| `gen_ai.response.finish_reason` | string | "stop", "length", etc. |
| `gen_ai.usage.input_tokens` | int | Prompt tokens consumed |
| `gen_ai.usage.output_tokens` | int | Completion tokens generated |

### FerrumDeck Extensions

| Attribute | Type | Description |
|-----------|------|-------------|
| `ferrumdeck.run.id` | string | Run UUID |
| `ferrumdeck.step.id` | string | Step UUID |
| `ferrumdeck.tenant.id` | string | Tenant UUID |
| `ferrumdeck.agent.id` | string | Agent identifier |
| `ferrumdeck.cost.cents` | float | Calculated cost in cents |
| `ferrumdeck.tool.name` | string | MCP tool name |
| `ferrumdeck.policy.decision` | string | allow/deny/require_approval |

### Span Structure

```
Run (root span)
├── Step: LLM (gen_ai span)
│   ├── LLM API Call
│   └── Token Processing
├── Step: Tool (ferrumdeck span)
│   ├── Policy Check
│   ├── Tool Execution
│   └── Result Processing
└── Step: Sandbox (ferrumdeck span)
    └── Code Execution
```

### Metrics

| Metric | Type | Unit | Description |
|--------|------|------|-------------|
| `ferrumdeck.run.duration` | Histogram | ms | Total run duration |
| `ferrumdeck.step.duration` | Histogram | ms | Step execution time |
| `ferrumdeck.tokens.consumed` | Counter | tokens | Total tokens used |
| `ferrumdeck.cost.incurred` | Counter | cents | Total cost incurred |
| `ferrumdeck.policy.decisions` | Counter | - | Policy decision counts |

## Consequences

### Positive
- **Standards compliance**: Interoperable with GenAI observability ecosystem
- **Rich debugging**: Full context in traces for troubleshooting
- **Cost attribution**: Accurate cost tracking per tenant/run
- **Future-proof**: Following emerging industry standards

### Negative
- **Attribute overhead**: Many attributes per span increase telemetry volume
- **Experimental conventions**: GenAI conventions may change
- **Privacy concerns**: Must avoid logging prompts/completions in traces

### Mitigations
- Use sampling (10% in production) to reduce volume
- Pin to specific convention version, migrate intentionally
- Implement content redaction for sensitive fields

## Implementation

### Rust (fd-otel crate)
```rust
pub fn trace_llm_call<F, T>(
    model: &str,
    system: &str,
    max_tokens: i64,
    // ...
    f: F,
) -> T
where
    F: FnOnce(&mut Span) -> T;
```

### Python (fd-runtime)
```python
@contextmanager
def trace_llm_call(
    model: str,
    system: str,
    max_tokens: int,
    # ...
) -> Iterator[Span]:
    ...
```

## Cost Calculation

```python
PRICING = {
    "claude-3-haiku": {"input": 0.25, "output": 1.25},  # per 1M tokens
    "claude-sonnet-4-20250514": {"input": 3.0, "output": 15.0},
    "claude-3-opus": {"input": 15.0, "output": 75.0},
}

def calculate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    rates = PRICING.get(model, {"input": 0, "output": 0})
    return (
        input_tokens * rates["input"] / 1_000_000 +
        output_tokens * rates["output"] / 1_000_000
    ) * 100  # Return cents
```

## Alternatives Considered

### 1. Custom Telemetry Schema
- Define our own attributes from scratch
- Rejected: Reinventing the wheel, no ecosystem benefits

### 2. LangSmith/Weights & Biases
- Use specialized LLM observability platforms
- Rejected: Vendor lock-in, additional cost, less control

### 3. Logs Only
- Use structured logging instead of traces
- Rejected: Loses distributed context, harder to debug

## References

- [OTel GenAI Semantic Conventions](https://github.com/open-telemetry/semantic-conventions/tree/main/docs/gen-ai)
- [OpenTelemetry Python SDK](https://opentelemetry.io/docs/languages/python/)
- [OpenTelemetry Rust SDK](https://docs.rs/opentelemetry/latest/opentelemetry/)
