"""Tool-call firing-rate metric — Python projection.

This module mirrors the Rust `fd_otel::firing_rate` shape so the worker / eval
plane can compute the same derived signal without crossing an FFI boundary.
The OTel attribute keys are imported from ``fd_runtime.tracing`` — both
planes write the same span attributes, so a single Jaeger trace shows one
schema regardless of which side recorded it.

The compute is deterministic and pure. Same inputs → same output, on every
machine, on every CI run.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from fd_runtime.tracing import FD_TOOL_FIRING_DEFAULT_THRESHOLD

# Step-type discriminator strings as they appear in the FerrumDeck step schema
# (`rust/crates/fd-storage/src/models/steps.rs` — snake_case serde rename).
_STEP_TYPE_LLM = "llm"
_STEP_TYPE_TOOL = "tool"


@dataclass(frozen=True)
class FiringRate:
    """Per-window firing-rate snapshot.

    Same field shape as the Rust :py:class:`fd_otel::firing_rate::FiringRate`
    struct so the JSON wire contract is one shape, not two.
    """

    reasoning_steps: int
    invoking_steps: int
    rate: float
    low_firing_rate_breached: bool
    low_firing_rate_threshold: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "reasoning_steps": self.reasoning_steps,
            "invoking_steps": self.invoking_steps,
            "rate": self.rate,
            "low_firing_rate_breached": self.low_firing_rate_breached,
            "low_firing_rate_threshold": self.low_firing_rate_threshold,
        }

    @property
    def is_empty(self) -> bool:
        return self.reasoning_steps == 0


def compute(
    reasoning_steps: int,
    invoking_steps: int,
    threshold: float = FD_TOOL_FIRING_DEFAULT_THRESHOLD,
) -> FiringRate:
    """Pure compute. Mirrors Rust ``FiringRate::compute_with_threshold``.

    ``invoking_steps`` is clamped to ``reasoning_steps`` so a mis-reported
    counter can't produce a rate > 1.0. An empty window returns a zero-rate,
    not-breached snapshot — absence of data must not page anyone.
    """
    if reasoning_steps < 0 or invoking_steps < 0:
        raise ValueError("step counters must be non-negative")
    invoking_steps = min(invoking_steps, reasoning_steps)
    rate = (invoking_steps / reasoning_steps) if reasoning_steps > 0 else 0.0
    breached = reasoning_steps > 0 and rate < threshold
    return FiringRate(
        reasoning_steps=reasoning_steps,
        invoking_steps=invoking_steps,
        rate=rate,
        low_firing_rate_breached=breached,
        low_firing_rate_threshold=threshold,
    )


def compute_from_steps(
    steps: Iterable[dict[str, Any]],
    threshold: float = FD_TOOL_FIRING_DEFAULT_THRESHOLD,
) -> FiringRate:
    """Derive the metric from a list of step dicts.

    A reasoning step is ``step_type == "llm"``. A reasoning step has
    *invoked* a tool when at least one other step in the same list has
    ``parent_step_id`` equal to its ``id`` and ``step_type == "tool"``.

    The function takes any iterable of dicts so it works on:
    - rows fetched from the gateway (``GET /v1/runs/:id/steps``),
    - the synthetic step list used by the golden-trace regression,
    - any future replay fixture.
    """
    steps_list = list(steps)

    reasoning_ids: list[str] = []
    tool_parent_ids: set[str] = set()
    for step in steps_list:
        step_type = step.get("step_type")
        if step_type == _STEP_TYPE_LLM:
            step_id = step.get("id")
            if step_id is not None:
                reasoning_ids.append(step_id)
        elif step_type == _STEP_TYPE_TOOL:
            parent = step.get("parent_step_id")
            if parent is not None:
                tool_parent_ids.add(parent)

    reasoning = len(reasoning_ids)
    invoking = sum(1 for rid in reasoning_ids if rid in tool_parent_ids)
    return compute(reasoning, invoking, threshold)


__all__ = [
    "FiringRate",
    "compute",
    "compute_from_steps",
]
