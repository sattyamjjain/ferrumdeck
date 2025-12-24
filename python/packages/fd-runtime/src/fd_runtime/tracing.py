"""OpenTelemetry tracing utilities with GenAI semantic conventions."""

import os
from collections.abc import Generator
from contextlib import contextmanager

from opentelemetry import trace
from opentelemetry.context import Context
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import SERVICE_NAME, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace import Span, Status, StatusCode
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

# GenAI semantic convention attribute names
# See: https://opentelemetry.io/docs/specs/semconv/gen-ai/
GEN_AI_SYSTEM = "gen_ai.system"
GEN_AI_REQUEST_MODEL = "gen_ai.request.model"
GEN_AI_REQUEST_MAX_TOKENS = "gen_ai.request.max_tokens"
GEN_AI_REQUEST_TEMPERATURE = "gen_ai.request.temperature"
GEN_AI_RESPONSE_MODEL = "gen_ai.response.model"
GEN_AI_RESPONSE_FINISH_REASON = "gen_ai.response.finish_reasons"
GEN_AI_USAGE_INPUT_TOKENS = "gen_ai.usage.input_tokens"
GEN_AI_USAGE_OUTPUT_TOKENS = "gen_ai.usage.output_tokens"

# Tool semantic conventions
TOOL_NAME = "tool.name"
TOOL_SERVER = "tool.server"
TOOL_STATUS = "tool.status"

# Cost tracking attributes
GEN_AI_USAGE_COST_USD = "gen_ai.usage.cost_usd"
GEN_AI_USAGE_COST_INPUT_USD = "gen_ai.usage.cost_input_usd"
GEN_AI_USAGE_COST_OUTPUT_USD = "gen_ai.usage.cost_output_usd"
GEN_AI_USAGE_TOTAL_TOKENS = "gen_ai.usage.total_tokens"

# FerrumDeck-specific attributes
FD_RUN_ID = "ferrumdeck.run.id"
FD_STEP_ID = "ferrumdeck.step.id"
FD_STEP_TYPE = "ferrumdeck.step.type"
FD_TENANT_ID = "ferrumdeck.tenant.id"
FD_AGENT_ID = "ferrumdeck.agent.id"

# Model pricing per 1M tokens (as of Dec 2024)
# https://www.anthropic.com/pricing#anthropic-api
MODEL_PRICING: dict[str, dict[str, float]] = {
    # Anthropic models
    "claude-opus-4-20250514": {"input": 15.0, "output": 75.0},
    "claude-sonnet-4-20250514": {"input": 3.0, "output": 15.0},
    "claude-3-5-sonnet-20241022": {"input": 3.0, "output": 15.0},
    "claude-3-5-haiku-20241022": {"input": 0.80, "output": 4.0},
    "claude-3-opus-20240229": {"input": 15.0, "output": 75.0},
    "claude-3-sonnet-20240229": {"input": 3.0, "output": 15.0},
    "claude-3-haiku-20240307": {"input": 0.25, "output": 1.25},
    # OpenAI models
    "gpt-4o": {"input": 2.50, "output": 10.0},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "gpt-4-turbo": {"input": 10.0, "output": 30.0},
    "gpt-4": {"input": 30.0, "output": 60.0},
    "gpt-3.5-turbo": {"input": 0.50, "output": 1.50},
}

_tracer: trace.Tracer | None = None
_propagator = TraceContextTextMapPropagator()


def init_tracing(
    service_name: str = "fd-worker",
    endpoint: str | None = None,
) -> None:
    """Initialize OpenTelemetry tracing.

    Args:
        service_name: Name of the service for traces
        endpoint: OTLP endpoint (defaults to OTEL_EXPORTER_OTLP_ENDPOINT or localhost:4317)
    """
    global _tracer

    endpoint = endpoint or os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4317")

    resource = Resource.create(
        {
            SERVICE_NAME: service_name,
            "service.version": "0.1.0",
        }
    )

    provider = TracerProvider(resource=resource)

    exporter = OTLPSpanExporter(endpoint=endpoint, insecure=True)
    processor = BatchSpanProcessor(exporter)
    provider.add_span_processor(processor)

    trace.set_tracer_provider(provider)
    _tracer = trace.get_tracer(service_name, "0.1.0")


def get_tracer() -> trace.Tracer:
    """Get the configured tracer, initializing if needed."""
    global _tracer
    if _tracer is None:
        init_tracing()
    return _tracer  # type: ignore


def extract_context(headers: dict[str, str]) -> Context:
    """Extract trace context from HTTP headers."""
    return _propagator.extract(carrier=headers)


def inject_context(headers: dict[str, str]) -> None:
    """Inject trace context into HTTP headers."""
    _propagator.inject(carrier=headers)


@contextmanager
def trace_llm_call(
    model: str,
    system: str = "anthropic",
    max_tokens: int | None = None,
    temperature: float | None = None,
    run_id: str | None = None,
    step_id: str | None = None,
) -> Generator[Span, None, None]:
    """Context manager for tracing LLM calls with GenAI semantic conventions.

    Usage:
        with trace_llm_call("claude-sonnet-4-20250514", run_id=run_id) as span:
            response = await llm.complete(...)
            span.set_attribute(GEN_AI_USAGE_INPUT_TOKENS, response.usage.input_tokens)
            span.set_attribute(GEN_AI_USAGE_OUTPUT_TOKENS, response.usage.output_tokens)
    """
    tracer = get_tracer()

    with tracer.start_as_current_span("gen_ai.completion") as span:
        span.set_attribute(GEN_AI_SYSTEM, system)
        span.set_attribute(GEN_AI_REQUEST_MODEL, model)

        if max_tokens is not None:
            span.set_attribute(GEN_AI_REQUEST_MAX_TOKENS, max_tokens)
        if temperature is not None:
            span.set_attribute(GEN_AI_REQUEST_TEMPERATURE, temperature)
        if run_id:
            span.set_attribute(FD_RUN_ID, run_id)
        if step_id:
            span.set_attribute(FD_STEP_ID, step_id)

        try:
            yield span
        except Exception as e:
            span.set_status(Status(StatusCode.ERROR, str(e)))
            span.record_exception(e)
            raise


@contextmanager
def trace_tool_call(
    tool_name: str,
    server: str | None = None,
    run_id: str | None = None,
    step_id: str | None = None,
) -> Generator[Span, None, None]:
    """Context manager for tracing tool calls.

    Usage:
        with trace_tool_call("github_create_pr", server="github-mcp") as span:
            result = await router.call_tool(...)
            span.set_attribute(TOOL_STATUS, "success")
    """
    tracer = get_tracer()

    with tracer.start_as_current_span(f"tool.{tool_name}") as span:
        span.set_attribute(TOOL_NAME, tool_name)

        if server:
            span.set_attribute(TOOL_SERVER, server)
        if run_id:
            span.set_attribute(FD_RUN_ID, run_id)
        if step_id:
            span.set_attribute(FD_STEP_ID, step_id)

        try:
            yield span
        except Exception as e:
            span.set_status(Status(StatusCode.ERROR, str(e)))
            span.set_attribute(TOOL_STATUS, "error")
            span.record_exception(e)
            raise


@contextmanager
def trace_step_execution(
    run_id: str,
    step_id: str,
    step_type: str,
    tenant_id: str | None = None,
    agent_id: str | None = None,
) -> Generator[Span, None, None]:
    """Context manager for tracing step execution.

    Usage:
        with trace_step_execution(run_id, step_id, "llm") as span:
            await executor.execute(step)
    """
    tracer = get_tracer()

    with tracer.start_as_current_span(f"step.execute.{step_type}") as span:
        span.set_attribute(FD_RUN_ID, run_id)
        span.set_attribute(FD_STEP_ID, step_id)
        span.set_attribute(FD_STEP_TYPE, step_type)

        if tenant_id:
            span.set_attribute(FD_TENANT_ID, tenant_id)
        if agent_id:
            span.set_attribute(FD_AGENT_ID, agent_id)

        try:
            yield span
        except Exception as e:
            span.set_status(Status(StatusCode.ERROR, str(e)))
            span.record_exception(e)
            raise


def calculate_cost(
    model: str,
    input_tokens: int,
    output_tokens: int,
) -> dict[str, float]:
    """Calculate estimated cost for LLM usage.

    Args:
        model: Model name (e.g., "claude-sonnet-4-20250514")
        input_tokens: Number of input tokens
        output_tokens: Number of output tokens

    Returns:
        Dictionary with cost breakdown:
        - input_cost_usd: Cost for input tokens
        - output_cost_usd: Cost for output tokens
        - total_cost_usd: Total cost
    """
    # Get pricing, defaulting to sonnet pricing if unknown
    pricing = MODEL_PRICING.get(model, {"input": 3.0, "output": 15.0})

    # Calculate costs (pricing is per 1M tokens)
    input_cost = (input_tokens / 1_000_000) * pricing["input"]
    output_cost = (output_tokens / 1_000_000) * pricing["output"]
    total_cost = input_cost + output_cost

    return {
        "input_cost_usd": round(input_cost, 6),
        "output_cost_usd": round(output_cost, 6),
        "total_cost_usd": round(total_cost, 6),
    }


def set_llm_response_attributes(
    span: Span,
    model: str,
    finish_reason: str,
    input_tokens: int,
    output_tokens: int,
) -> None:
    """Set response attributes on an LLM span, including cost tracking."""
    span.set_attribute(GEN_AI_RESPONSE_MODEL, model)
    span.set_attribute(GEN_AI_RESPONSE_FINISH_REASON, [finish_reason])
    span.set_attribute(GEN_AI_USAGE_INPUT_TOKENS, input_tokens)
    span.set_attribute(GEN_AI_USAGE_OUTPUT_TOKENS, output_tokens)
    span.set_attribute(GEN_AI_USAGE_TOTAL_TOKENS, input_tokens + output_tokens)

    # Calculate and set cost attributes
    cost = calculate_cost(model, input_tokens, output_tokens)
    span.set_attribute(GEN_AI_USAGE_COST_INPUT_USD, cost["input_cost_usd"])
    span.set_attribute(GEN_AI_USAGE_COST_OUTPUT_USD, cost["output_cost_usd"])
    span.set_attribute(GEN_AI_USAGE_COST_USD, cost["total_cost_usd"])
