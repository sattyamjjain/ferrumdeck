"""Tests for the enforcement-decision GenAI span emitter.

Data-plane mirror of the Rust ``fd_otel::decision`` contract: proves the
semconv resolver flips names under the opt-in, the decision-label helpers map
correctly, and an emitted span actually carries the right name + attributes.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from opentelemetry.sdk.trace import ReadableSpan, TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

import fd_runtime.tracing as tracing_mod
from fd_runtime.tracing import (
    GenAiSemconv,
    decision_label_from_response,
    decision_label_from_status,
    trace_tool_decision,
)

if TYPE_CHECKING:
    from collections.abc import Generator


@pytest.fixture
def spans() -> Generator[InMemorySpanExporter, None, None]:
    """Route ``get_tracer()`` to an in-memory exporter for the test's duration."""
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    prev = tracing_mod._tracer
    tracing_mod._tracer = provider.get_tracer("test")
    try:
        yield exporter
    finally:
        tracing_mod._tracer = prev


def _only_span(exporter: InMemorySpanExporter) -> ReadableSpan:
    finished = exporter.get_finished_spans()
    assert len(finished) == 1, f"expected exactly one span, got {len(finished)}"
    return finished[0]


class TestSemconvResolver:
    def test_default_when_unset_or_unrelated(self) -> None:
        assert GenAiSemconv.from_opt_in(None) is GenAiSemconv.DEFAULT
        assert GenAiSemconv.from_opt_in("") is GenAiSemconv.DEFAULT
        assert GenAiSemconv.from_opt_in("database") is GenAiSemconv.DEFAULT
        # A superstring must not match — exact token only.
        assert GenAiSemconv.from_opt_in("gen_ai_latest_experimental_x") is GenAiSemconv.DEFAULT

    def test_experimental_token_opts_in(self) -> None:
        assert (
            GenAiSemconv.from_opt_in("gen_ai_latest_experimental")
            is GenAiSemconv.LATEST_EXPERIMENTAL
        )
        assert (
            GenAiSemconv.from_opt_in("http/dup , gen_ai_latest_experimental")
            is GenAiSemconv.LATEST_EXPERIMENTAL
        )

    def test_opt_in_flips_names_and_keys(self) -> None:
        assert GenAiSemconv.DEFAULT.tool_span_name() == "gen_ai.tool.call"
        assert GenAiSemconv.LATEST_EXPERIMENTAL.tool_span_name() == "execute_tool"
        assert GenAiSemconv.DEFAULT.tool_call_id_key() == "gen_ai.tool.call_id"
        assert GenAiSemconv.LATEST_EXPERIMENTAL.tool_call_id_key() == "gen_ai.tool.call.id"
        assert GenAiSemconv.DEFAULT.operation_name() is None
        assert GenAiSemconv.LATEST_EXPERIMENTAL.operation_name() == "execute_tool"


class TestDecisionLabels:
    def test_from_allowlist_status(self) -> None:
        assert decision_label_from_status("allowed") == "allow"
        assert decision_label_from_status("requires_approval") == "approval"
        assert decision_label_from_status("denied") == "deny"
        # Unknown → deny-by-default.
        assert decision_label_from_status("mystery") == "deny"

    def test_from_check_tool_response(self) -> None:
        assert decision_label_from_response(allowed=True, requires_approval=False) == "allow"
        assert decision_label_from_response(allowed=False, requires_approval=True) == "approval"
        assert decision_label_from_response(allowed=False, requires_approval=False) == "deny"
        # Approval takes precedence over allowed.
        assert decision_label_from_response(allowed=True, requires_approval=True) == "approval"


class TestDecisionSpan:
    def test_default_mode_span_name_and_attrs(self, spans: InMemorySpanExporter) -> None:
        with trace_tool_decision(
            "delete_repo",
            "deny",
            "tool 'delete_repo' is not in allowlist",
            rung="R3",
            budget_remaining=0,
            call_id="pdc_deny",
            run_id="run_1",
            step_id="stp_1",
            semconv=GenAiSemconv.DEFAULT,
        ):
            pass

        span = _only_span(spans)
        assert span.name == "gen_ai.tool.call"
        attrs = dict(span.attributes or {})
        assert attrs["gen_ai.tool.name"] == "delete_repo"
        assert attrs["ferrumdeck.decision"] == "deny"
        assert attrs["ferrumdeck.reason"] == "tool 'delete_repo' is not in allowlist"
        assert attrs["ferrumdeck.rung"] == "R3"
        assert attrs["ferrumdeck.budget_remaining"] == 0
        assert attrs["gen_ai.tool.call_id"] == "pdc_deny"
        assert attrs["ferrumdeck.run.id"] == "run_1"
        # Stable convention must NOT emit the latest-experimental keys.
        assert "gen_ai.tool.call.id" not in attrs
        assert "gen_ai.operation.name" not in attrs

    def test_latest_experimental_flips_span_name_and_keys(
        self, spans: InMemorySpanExporter
    ) -> None:
        with trace_tool_decision(
            "read_file",
            "allow",
            "tool 'read_file' is in allowlist",
            rung="R1",
            call_id="pdc_allow",
            semconv=GenAiSemconv.LATEST_EXPERIMENTAL,
        ):
            pass

        span = _only_span(spans)
        assert span.name == "execute_tool"
        attrs = dict(span.attributes or {})
        assert attrs["gen_ai.operation.name"] == "execute_tool"
        assert attrs["gen_ai.tool.call.id"] == "pdc_allow"
        assert "gen_ai.tool.call_id" not in attrs
        assert attrs["ferrumdeck.decision"] == "allow"
        # budget_remaining was None → the attribute stays unset.
        assert "ferrumdeck.budget_remaining" not in attrs

    @pytest.mark.parametrize(
        ("decision", "reason"),
        [
            ("deny", "denied by allowlist"),
            ("approval", "reversibility ladder (irreversible, R3) requires approval"),
            ("kill", "budget exceeded: cost 600 > 500 cents"),
        ],
    )
    def test_each_outcome_carries_its_reason(
        self, spans: InMemorySpanExporter, decision: str, reason: str
    ) -> None:
        with trace_tool_decision("some_tool", decision, reason, semconv=GenAiSemconv.DEFAULT):
            pass

        span = _only_span(spans)
        attrs = dict(span.attributes or {})
        assert attrs["ferrumdeck.decision"] == decision
        assert attrs["ferrumdeck.reason"] == reason
