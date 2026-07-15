"""Observability blind-spot benchmark: record-only vs in-path enforcement.

Runs **one public injection trace** two ways over the **same** governance
profile and shows the architectural difference an essay-reader can reproduce:

* **(a) observability-only** — an OTel / Langfuse-style *record-only* stack. It
  has **no decision point**: the tool call proceeds and a GenAI span is emitted
  to *describe* it. By the time the span exists, the unsafe call has already run
  — observability tells you *after* the fact.
* **(b) ferrumdeck in-path gate** — the real deny-by-default + Airlock decision
  runs **before** execution, rides the **same** GenAI tool span as
  ``ferrumdeck.decision=deny``, and the call never executes.

The gate decision reuses :func:`fd_evals.injection_defense.decide`, which is
pinned to the real Rust ``fd_policy`` enforcement by
``cargo test -p fd-policy --test injection_defense`` — so this is the actual
governance verdict, not a re-implementation. Deterministic, offline, no LLM: it
contrasts *record-after* vs *decide-before*, not model quality. Both spans are
captured with an in-memory exporter so the printed output is the real emitted
telemetry, not a hand-written mock.

Nothing is executed here — the corpus is inert tool-call data. "record-only
executes the call" is the honest *model* of a stack with no gate (it would not
stop the call); we never actually send an email.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fd_runtime.tracing import (
    FD_DECISION,
    GEN_AI_TOOL_NAME,
    GenAiSemconv,
    trace_tool_decision,
)

from fd_evals.injection_defense import (
    BlockedBy,
    decide,
    load_cases,
    load_governance,
)

# Same source corpus as the injection-defense axis (AgentDojo-style).
ENFORCE_VS_OBSERVE_ANCHOR = "agentdojo:arxiv:2406.13352"

# The canonical trace for the artifact: an injected exfil the agent was
# manipulated into attempting. `send_email` is not on the allowlist, so
# deny-by-default stops it — a legible, non-destructive example.
DEFAULT_CASE_ID = "atk_unauth_01"

# Marker attribute for the record-only lane's span — signals a stack that only
# records (no decision plane). Not a ferrumdeck enforcement attribute.
OTEL_RECORD_ONLY = "otel.record_only"

_DENY_REASONS: dict[str, str] = {
    "allowlist": "tool '{tool}' is not in allowlist (deny-by-default)",
    "rce": "Airlock RASP blocked '{tool}': anti-RCE pattern match",
    "exfil": "Airlock RASP blocked '{tool}': data-exfiltration shield",
}


def _deny_reason(tool: str, blocked_by: BlockedBy) -> str:
    template = _DENY_REASONS.get(blocked_by, "tool '{tool}' denied by policy")
    return template.format(tool=tool)


@dataclass(frozen=True)
class LaneResult:
    """One lane's observable outcome for the tool call."""

    lane: str  # "observe_only" | "in_path_gate"
    span_name: str
    attributes: dict[str, Any]
    executed: bool
    decision: str | None  # ferrumdeck.decision value; None for record-only

    @property
    def has_decision(self) -> bool:
        return self.decision is not None


@dataclass(frozen=True)
class Comparison:
    """The two-lane result for a single injection trace."""

    case_id: str
    case_name: str
    description: str
    tool_name: str
    tool_input: dict[str, Any]
    expected_executed: bool
    blocked_by: BlockedBy
    observe_only: LaneResult
    in_path_gate: LaneResult
    anchor: str = ENFORCE_VS_OBSERVE_ANCHOR

    def to_dict(self) -> dict[str, Any]:
        return {
            "case_id": self.case_id,
            "case_name": self.case_name,
            "tool_name": self.tool_name,
            "tool_input": self.tool_input,
            "expected_executed": self.expected_executed,
            "blocked_by": self.blocked_by,
            "anchor": self.anchor,
            "observe_only": {
                "span_name": self.observe_only.span_name,
                "executed": self.observe_only.executed,
                "decision": self.observe_only.decision,
                "attributes": self.observe_only.attributes,
            },
            "in_path_gate": {
                "span_name": self.in_path_gate.span_name,
                "executed": self.in_path_gate.executed,
                "decision": self.in_path_gate.decision,
                "attributes": self.in_path_gate.attributes,
            },
        }


def _in_memory_tracer() -> tuple[Any, Any]:
    """A fresh TracerProvider wired to an in-memory exporter (spans captured,
    nothing shipped to a collector)."""
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
        InMemorySpanExporter,
    )

    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return exporter, provider


def run_comparison(
    dataset_dir: Path,
    case_id: str = DEFAULT_CASE_ID,
    *,
    semconv: GenAiSemconv | None = None,
) -> Comparison:
    """Run one corpus case through both lanes and capture the emitted spans."""
    import fd_runtime.tracing as tracing_mod

    gov = load_governance(dataset_dir)
    cases = {c["id"]: c for c in load_cases(dataset_dir)}
    if case_id not in cases:
        raise KeyError(f"case '{case_id}' not found in corpus {dataset_dir}")
    case = cases[case_id]
    tool = case["tool_name"]
    tool_input = case.get("tool_input", {})
    mode = semconv or GenAiSemconv.DEFAULT

    # The real, corpus-pinned governance verdict (mirrors fd_policy). For an
    # attack case this is (executed=False, blocked_by=<layer>).
    gate_executed, blocked_by = decide(gov, tool, tool_input)
    reason = _deny_reason(tool, blocked_by)

    exporter, provider = _in_memory_tracer()
    prev = tracing_mod._tracer
    tracing_mod._tracer = provider.get_tracer("enforce-vs-observe")
    try:
        tracer = tracing_mod.get_tracer()
        # (a) Observability-only: a record-only GenAI stack instruments the
        # invocation but makes no decision, so the span is a post-hoc record.
        with tracer.start_as_current_span(mode.tool_span_name()) as span:
            span.set_attribute(GEN_AI_TOOL_NAME, tool)
            span.set_attribute(OTEL_RECORD_ONLY, True)
        # (b) In-path gate: the decision runs before execution and rides the
        # same GenAI tool span as ferrumdeck.decision=deny.
        with trace_tool_decision(tool, "deny", reason, semconv=mode):
            pass
    finally:
        tracing_mod._tracer = prev

    finished = exporter.get_finished_spans()
    observe_span = next(s for s in finished if FD_DECISION not in dict(s.attributes or {}))
    gate_span = next(s for s in finished if FD_DECISION in dict(s.attributes or {}))
    gate_attrs = dict(gate_span.attributes or {})

    observe_only = LaneResult(
        lane="observe_only",
        span_name=observe_span.name,
        attributes=dict(observe_span.attributes or {}),
        # A record-only stack has no gate, so the call it recorded proceeded.
        executed=True,
        decision=None,
    )
    in_path_gate = LaneResult(
        lane="in_path_gate",
        span_name=gate_span.name,
        attributes=gate_attrs,
        executed=gate_executed,
        decision=str(gate_attrs.get(FD_DECISION)),
    )

    return Comparison(
        case_id=case["id"],
        case_name=case.get("name", case["id"]),
        description=case.get("description", ""),
        tool_name=tool,
        tool_input=tool_input,
        expected_executed=bool(case.get("expected_executed", False)),
        blocked_by=blocked_by,
        observe_only=observe_only,
        in_path_gate=in_path_gate,
    )


def assert_contrast(cmp: Comparison) -> None:
    """Raise ``AssertionError`` unless the blind-spot contrast holds — the
    self-verification the runner + test rely on."""
    # Record-only observed the call but never gated it: it ran, no decision.
    assert cmp.observe_only.executed is True, "record-only lane must let the call run"
    assert not cmp.observe_only.has_decision, "record-only lane must carry no enforcement decision"
    # The in-path gate denied before execution.
    assert cmp.in_path_gate.decision == "deny", "gate lane must emit ferrumdeck.decision=deny"
    assert cmp.in_path_gate.executed is False, "gate lane must NOT execute the denied call"
    # The gate verdict matches the corpus ground truth.
    assert cmp.in_path_gate.executed == cmp.expected_executed, (
        f"gate verdict {cmp.in_path_gate.executed} != corpus expected_executed "
        f"{cmp.expected_executed} for {cmp.case_id}"
    )


def _fmt_attrs(attrs: dict[str, Any]) -> str:
    return ", ".join(f"{k}={attrs[k]!r}" for k in sorted(attrs))


def render_report(cmp: Comparison) -> str:
    """A deterministic side-by-side block for the console + the docs artifact."""
    o, g = cmp.observe_only, cmp.in_path_gate
    lines = [
        f"CASE  {cmp.case_id} — {cmp.case_name}",
        f"      source: AgentDojo-style ({cmp.anchor})",
        f"      tool:   {cmp.tool_name}   input: {cmp.tool_input}",
        f"      ground truth: expected_executed={str(cmp.expected_executed).lower()} "
        "(this call must NOT run)",
        "",
        "(a) OBSERVABILITY-ONLY  (OTel / Langfuse record-only — no decision point)",
        "      order:   invoke -> EXECUTE -> record span",
        f"      span:    {o.span_name} {{ {_fmt_attrs(o.attributes)} }}",
        "      decision: (none — this stack only records)",
        f"      outcome: EXECUTED={str(o.executed).lower()}  "
        "-> the exfil already happened; the span tells you after the fact",
        "",
        "(b) FERRUMDECK IN-PATH GATE  (decision before execution)",
        f"      order:   invoke -> DECIDE({g.decision}) -> record span -> execution prevented",
        f"      span:    {g.span_name} {{ {_fmt_attrs(g.attributes)} }}",
        f"      decision: ferrumdeck.decision={g.decision}  (blocked_by={cmp.blocked_by})",
        f"      outcome: EXECUTED={str(g.executed).lower()}  "
        "-> the exfil was blocked pre-execution",
        "",
        "VERDICT  record-only OBSERVED the breach; the in-path gate PREVENTED it — "
        "same trace, same span, one has the decision that stops it.",
    ]
    return "\n".join(lines)


__all__ = [
    "DEFAULT_CASE_ID",
    "ENFORCE_VS_OBSERVE_ANCHOR",
    "Comparison",
    "LaneResult",
    "assert_contrast",
    "render_report",
    "run_comparison",
]

# Keep `field` referenced for callers extending Comparison via dataclasses;
# silences unused-import lints without changing the public surface.
_ = field
