"""Golden-trace regression for the tool-call firing-rate metric.

A synthetic step list — one LLM step with a tool child, one LLM step
without — gets piped through :func:`fd_evals.firing_rate.compute_from_steps`
and the resulting export-shape JSON is diffed against
``tests/fixtures/tool_call_firing_rate.golden.json``.

The export shape is the public contract used by:
- the Rust gateway when it tags the run-completion span (via
  ``fd_otel::firing_rate::record_on_span``),
- the Next.js dashboard's TanStack-Query cache,
- any downstream OTel consumer (Jaeger, Tempo, custom OTLP collector).

If the schema must legitimately change:
1. Update the Rust :class:`FiringRate` struct + the Python mirror in lockstep.
2. Update ``docs/runbooks/tool-call-firing-rate.md`` to reflect the new shape.
3. Re-bless this golden with
   ``BLESS=1 uv run pytest python/packages/fd-evals/tests/test_tool_call_firing_rate_golden.py``.
4. Commit all three together so the wire change is visible.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest
from fd_runtime.tracing import (
    FD_TOOL_FIRING_DEFAULT_THRESHOLD,
    FD_TOOL_FIRING_INVOKING_STEPS,
    FD_TOOL_FIRING_LOW_BREACHED,
    FD_TOOL_FIRING_LOW_THRESHOLD,
    FD_TOOL_FIRING_RATE,
    FD_TOOL_FIRING_REASONING_STEPS,
)

from fd_evals.firing_rate import FiringRate, compute, compute_from_steps

GOLDEN_PATH = Path(__file__).parent / "fixtures" / "tool_call_firing_rate.golden.json"


def _synthetic_workflow_steps() -> list[dict[str, Any]]:
    """Three LLM steps, two of which spawn a tool child → 2/3 = 0.6667 rate.

    Above the default 0.40 threshold, so this fixture is the "healthy"
    baseline. A drop here is the dashboard-panel alert path.
    """
    return [
        # LLM 1 — invokes a tool.
        {
            "id": "stp_llm_001",
            "run_id": "run_fixture_001",
            "parent_step_id": None,
            "step_number": 1,
            "step_type": "llm",
            "tool_name": None,
            "status": "completed",
        },
        # Tool child of LLM 1.
        {
            "id": "stp_tool_001",
            "run_id": "run_fixture_001",
            "parent_step_id": "stp_llm_001",
            "step_number": 2,
            "step_type": "tool",
            "tool_name": "read_file",
            "status": "completed",
        },
        # LLM 2 — invokes a tool.
        {
            "id": "stp_llm_002",
            "run_id": "run_fixture_001",
            "parent_step_id": None,
            "step_number": 3,
            "step_type": "llm",
            "tool_name": None,
            "status": "completed",
        },
        # Tool child of LLM 2.
        {
            "id": "stp_tool_002",
            "run_id": "run_fixture_001",
            "parent_step_id": "stp_llm_002",
            "step_number": 4,
            "step_type": "tool",
            "tool_name": "write_file",
            "status": "completed",
        },
        # LLM 3 — pure reasoning, no tool follow-up.
        {
            "id": "stp_llm_003",
            "run_id": "run_fixture_001",
            "parent_step_id": None,
            "step_number": 5,
            "step_type": "llm",
            "tool_name": None,
            "status": "completed",
        },
    ]


def _export_shape(metric: FiringRate) -> dict[str, Any]:
    """Mirror the OTel attribute set the worker / gateway tags on the span.

    The keys are the canonical span-attribute names — the same strings the
    Rust ``fd_otel::firing_rate::record_on_span`` writes. This guarantees the
    eval plane and the OTel exporter agree on the wire shape.
    """
    return {
        "metric": metric.to_dict(),
        "otel_attributes": {
            FD_TOOL_FIRING_RATE: metric.rate,
            FD_TOOL_FIRING_REASONING_STEPS: metric.reasoning_steps,
            FD_TOOL_FIRING_INVOKING_STEPS: metric.invoking_steps,
            FD_TOOL_FIRING_LOW_BREACHED: metric.low_firing_rate_breached,
            FD_TOOL_FIRING_LOW_THRESHOLD: metric.low_firing_rate_threshold,
        },
    }


def _render(export: dict[str, Any]) -> str:
    return json.dumps(export, indent=2, sort_keys=True) + "\n"


def test_synthetic_workflow_export_matches_golden() -> None:
    """Compute → export-shape JSON → diff against the blessed golden.

    BLESS=1 rewrites the golden in place when the schema change is
    intentional. See the module docstring for the renegotiation checklist.
    """
    steps = _synthetic_workflow_steps()
    metric = compute_from_steps(steps)
    actual = _render(_export_shape(metric))

    if os.environ.get("BLESS") == "1":
        GOLDEN_PATH.parent.mkdir(parents=True, exist_ok=True)
        GOLDEN_PATH.write_text(actual)
        return

    if not GOLDEN_PATH.exists():
        pytest.fail(
            f"golden file {GOLDEN_PATH} not found; generate it once with "
            f"`BLESS=1 uv run pytest "
            f"python/packages/fd-evals/tests/test_tool_call_firing_rate_golden.py`"
        )

    expected = GOLDEN_PATH.read_text()
    assert actual == expected, (
        "\n\nTool-call firing-rate export shape drifted from the contract.\n"
        "If this is intentional:\n"
        "  1. Update fd_otel::firing_rate (Rust) + fd_evals.firing_rate (Python) in lockstep.\n"
        "  2. Update docs/runbooks/tool-call-firing-rate.md to reflect the new shape.\n"
        "  3. Re-bless with: BLESS=1 uv run pytest "
        "python/packages/fd-evals/tests/test_tool_call_firing_rate_golden.py\n"
        f"\nGolden: {GOLDEN_PATH}\n"
    )


def test_compute_matches_compute_from_steps() -> None:
    """Sanity: the structural compute path agrees with the direct compute."""
    steps = _synthetic_workflow_steps()
    via_steps = compute_from_steps(steps)
    via_direct = compute(reasoning_steps=3, invoking_steps=2)
    assert via_steps == via_direct


def test_empty_step_list_does_not_breach() -> None:
    metric = compute_from_steps([])
    assert metric.is_empty
    assert metric.rate == 0.0
    assert metric.low_firing_rate_breached is False


def test_low_rate_breaches_default_threshold() -> None:
    # 1/5 = 0.20, below the default 0.40 → breach.
    steps: list[dict[str, Any]] = [{"id": f"stp_llm_{i}", "step_type": "llm"} for i in range(5)]
    steps.append(
        {
            "id": "stp_tool_a",
            "parent_step_id": "stp_llm_0",
            "step_type": "tool",
            "tool_name": "x",
        }
    )

    metric = compute_from_steps(steps)
    assert metric.reasoning_steps == 5
    assert metric.invoking_steps == 1
    assert metric.low_firing_rate_breached is True
    assert metric.low_firing_rate_threshold == FD_TOOL_FIRING_DEFAULT_THRESHOLD
