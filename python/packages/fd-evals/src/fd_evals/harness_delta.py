"""Eval-driven harness/policy deltas - the trace->delta half of the HarnessX loop.

Derives *proposed* harness adjustments from the aggregate signal across eval
runs and shapes them for the control-plane ``POST /v1/harness-suggestions``
endpoint, which records them as proposals for human review. Nothing here
applies a change - deny-by-default and human-in-the-loop live in the gateway.
The wire shape mirrors the Rust ``fd_policy::harness::HarnessSuggestion`` record.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from fd_evals.task import EvalRunSummary

# Stable anchor, mirrored on the Rust side (``fd_policy::harness::HARNESS_ANCHOR``).
HARNESS_ANCHOR = "harnessx-trace-to-delta"


@dataclass
class HarnessDeltaEvidence:
    """One piece of trace-derived evidence behind a delta."""

    code: str
    detail: str
    observed: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {"code": self.code, "detail": self.detail, "observed": self.observed}


@dataclass
class HarnessDelta:
    """A proposed, NOT-auto-applied harness/policy change derived from traces."""

    agent_id: str
    kind: str  # "tool_scope" | "budget" | "policy"
    current: dict[str, Any]
    proposed: dict[str, Any]
    reason: str
    evidence: list[HarnessDeltaEvidence] = field(default_factory=list)
    confidence: float = 0.0
    source_eval_run_id: str | None = None

    def to_create_request(self) -> dict[str, Any]:
        """Shape for ``POST /v1/harness-suggestions`` (matches the Rust DTO)."""
        return {
            "agent_id": self.agent_id,
            "source_eval_run_id": self.source_eval_run_id,
            "kind": self.kind,
            "current": self.current,
            "proposed": self.proposed,
            "reason": self.reason,
            "evidence": [e.to_dict() for e in self.evidence],
            "confidence": self.confidence,
        }


@dataclass
class HarnessDeltaConfig:
    """Thresholds for the derivation rules."""

    agent_id: str
    # The current per-run budget cap (cents) to compare against. ``None``
    # disables the budget rule.
    per_run_cap_cents: float | None = None
    # Propose a budget delta once at least this fraction of runs breach the cap.
    budget_breach_rate_threshold: float = 0.5
    # Proposed (tighter) cap = current * this factor.
    proposed_cap_factor: float = 0.8
    # Propose a policy delta when aggregate pass rate falls below this.
    min_pass_rate: float = 0.7
    # Don't derive anything from fewer than this many runs (a handful of runs
    # is not enough signal to propose a governance change).
    min_runs: int = 3


def derive_harness_deltas(
    summaries: list[EvalRunSummary],
    config: HarnessDeltaConfig,
) -> list[HarnessDelta]:
    """Derive proposed harness deltas from a window of eval-run summaries.

    Pure: no I/O. v1 emits two rule types, both from fields already present on
    :class:`~fd_evals.task.EvalRunSummary`, so the derivation is honest about
    what the trace actually carries:

    - **budget**: when run cost breaches ``per_run_cap_cents`` on at least
      ``budget_breach_rate_threshold`` of runs, propose a tighter cap
      (``current * proposed_cap_factor``) for review.
    - **policy**: when the aggregate pass rate falls below ``min_pass_rate``,
      propose requiring approval pending investigation.
    """
    runs = list(summaries)
    n = len(runs)
    deltas: list[HarnessDelta] = []
    if n < config.min_runs:
        return deltas

    latest_run_id = runs[-1].run_id

    # Budget-breach rule.
    cap = config.per_run_cap_cents
    if cap is not None and cap > 0:
        breached = [s for s in runs if s.total_cost_cents > cap]
        rate = len(breached) / n
        if rate >= config.budget_breach_rate_threshold:
            new_cap = round(cap * config.proposed_cap_factor, 2)
            deltas.append(
                HarnessDelta(
                    agent_id=config.agent_id,
                    kind="budget",
                    current={"per_run_cap_cents": cap},
                    proposed={"per_run_cap_cents": new_cap},
                    reason=(
                        f"run cost exceeded the {cap:g}-cent cap on {len(breached)}/{n} "
                        "runs; propose a tighter cap for review"
                    ),
                    evidence=[
                        HarnessDeltaEvidence(
                            "budget_breach_rate",
                            f"{len(breached)}/{n} runs over the per-run cap",
                            round(rate, 4),
                        )
                    ],
                    confidence=round(rate, 4),
                    source_eval_run_id=latest_run_id,
                )
            )

    # Pass-rate rule.
    total_tasks = sum(s.total_tasks for s in runs)
    if total_tasks > 0:
        passed = sum(s.passed_tasks for s in runs)
        pass_rate = passed / total_tasks
        if pass_rate < config.min_pass_rate:
            deltas.append(
                HarnessDelta(
                    agent_id=config.agent_id,
                    kind="policy",
                    current={"require_approval": False},
                    proposed={"require_approval": True},
                    reason=(
                        f"aggregate pass rate {pass_rate:.0%} below the "
                        f"{config.min_pass_rate:.0%} floor; propose requiring approval "
                        "pending investigation"
                    ),
                    evidence=[
                        HarnessDeltaEvidence(
                            "low_pass_rate",
                            f"{passed}/{total_tasks} tasks passed",
                            round(pass_rate, 4),
                        )
                    ],
                    confidence=round(1.0 - pass_rate, 4),
                    source_eval_run_id=latest_run_id,
                )
            )

    return deltas
