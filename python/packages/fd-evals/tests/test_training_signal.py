"""Tests for training-signal score-override mapping (trace->signal).

The redacted JSONL itself is built server-side by the gateway (reusing the
audit redaction path); the Python side only computes run-level outcome-score
overrides, which is what these tests cover.
"""

from __future__ import annotations

from fd_evals.task import EvalResult
from fd_evals.training_signal import score_overrides_from_results


def _result(run_id: str | None, total_score: float) -> EvalResult:
    return EvalResult(
        task_id="t",
        task_name="t",
        run_id=run_id,
        passed=total_score >= 0.5,
        total_score=total_score,
        scorer_results=[],
        execution_time_ms=0,
        input_tokens=0,
        output_tokens=0,
        cost_cents=0.0,
    )


def test_maps_run_id_to_score() -> None:
    results = [_result("run_a", 0.9), _result("run_b", 0.1)]
    assert score_overrides_from_results(results) == {"run_a": 0.9, "run_b": 0.1}


def test_clamps_scores_to_unit_interval() -> None:
    results = [_result("run_a", 1.7), _result("run_b", -0.4)]
    assert score_overrides_from_results(results) == {"run_a": 1.0, "run_b": 0.0}


def test_skips_results_without_run_id() -> None:
    results = [_result(None, 0.8), _result("run_b", 0.5)]
    assert score_overrides_from_results(results) == {"run_b": 0.5}


def test_empty_results_yield_empty_map() -> None:
    assert score_overrides_from_results([]) == {}
