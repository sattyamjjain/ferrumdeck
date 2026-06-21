"""Training-signal export helpers - the trace->signal half of the HarnessX loop.

The redacted ``(state, action, observation, outcome_score)`` JSONL is produced
**server-side** by the gateway (``POST /v1/runs/{run_id}/training-signal``),
which reuses the audit redaction path (``fd_audit::redaction``). This module
deliberately does NOT build or redact the signal in Python - it only computes
the run-level outcome-score overrides the gateway layers on top of the
trace-intrinsic status score. An eval scores a whole *run*, not individual
steps, so the score is applied run-wide via the gateway's ``run_score`` field.
"""

from __future__ import annotations

from fd_evals.task import EvalResult


def score_overrides_from_results(results: list[EvalResult]) -> dict[str, float]:
    """Map each result's ``run_id`` to its clamped run-level outcome score.

    Pure. Results without a ``run_id`` are skipped (no run to attach a signal
    to). Scores are clamped to ``[0, 1]`` to match the training-signal
    contract. The caller passes a single run's score to the gateway as
    ``run_score`` when exporting that run's signal.
    """
    overrides: dict[str, float] = {}
    for result in results:
        if result.run_id is None:
            continue
        overrides[result.run_id] = max(0.0, min(1.0, result.total_score))
    return overrides
