"""Per-harness eval-dimension tests (Harness-Bench).

Covers:

- :class:`HarnessConfig` round-trip + content-hash stability.
- The execution-alignment-failure fixture: same model, two harnesses,
  distinct scores.
- :class:`DeltaReport` with per-side harness configs surfaces the
  per-dimension diff and the `(model × harness)` group labels.
- Backward compatibility: an :class:`EvalRunSummary` / serialized report
  with no harness config still loads and compares cleanly.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from fd_evals.delta import DeltaReport, DeltaReporter
from fd_evals.harness import (
    DEFAULT_PERMISSION_TIER,
    HARNESS_BENCH_ANCHOR,
    HarnessConfig,
    StateRecoveryConfig,
    ToolBinding,
    TracingConfig,
    diff_harness_configs,
    label_for_model_harness,
)
from fd_evals.task import EvalRunSummary

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "harness_alignment_failure.json"


# ---------------------------------------------------------------------------
# HarnessConfig — pure shape
# ---------------------------------------------------------------------------


def _strict_harness() -> HarnessConfig:
    return HarnessConfig(
        harness_id="strict-no-net",
        label="strict-policy-no-net",
        permission_tier="deny_by_default_strict",
        tools_available=(
            ToolBinding(name="read_file", version="1.0.0"),
            ToolBinding(name="write_file", version="1.0.0"),
            ToolBinding(name="search_code", version="1.0.0"),
        ),
        state_recovery=StateRecoveryConfig(
            max_retries=0, max_iterations=5, on_error="stop", replay_seed=1700000000
        ),
        tracing=TracingConfig(exporter="otlp", sample_rate=1.0, gen_ai_semconv_version="1.27.0"),
    )


def _permissive_harness() -> HarnessConfig:
    return HarnessConfig(
        harness_id="permissive-with-net",
        label="permissive-policy-with-net",
        permission_tier="permissive_with_net",
        tools_available=(
            ToolBinding(name="read_file", version="1.0.0"),
            ToolBinding(name="write_file", version="1.0.0"),
            ToolBinding(name="search_code", version="1.0.0"),
            ToolBinding(name="http_request", version="2.1.0"),
        ),
        state_recovery=StateRecoveryConfig(
            max_retries=2, max_iterations=12, on_error="continue", replay_seed=1700000000
        ),
        tracing=TracingConfig(exporter="otlp", sample_rate=1.0, gen_ai_semconv_version="1.27.0"),
    )


class TestHarnessConfigShape:
    def test_default_permission_tier_is_deny_by_default(self) -> None:
        h = HarnessConfig(harness_id="h", label="h")
        assert h.permission_tier == DEFAULT_PERMISSION_TIER
        assert h.anchor == HARNESS_BENCH_ANCHOR

    def test_round_trip_via_to_dict(self) -> None:
        h = _strict_harness()
        round_tripped = HarnessConfig.from_dict(h.to_dict())
        assert round_tripped == h

    def test_content_hash_is_stable(self) -> None:
        h1 = _strict_harness()
        h2 = _strict_harness()
        assert h1.content_hash() == h2.content_hash()

    def test_content_hash_changes_when_tier_changes(self) -> None:
        h = _strict_harness()
        h2 = HarnessConfig(
            harness_id=h.harness_id,
            label=h.label,
            permission_tier="permissive_with_net",  # changed
            tools_available=h.tools_available,
            state_recovery=h.state_recovery,
            tracing=h.tracing,
        )
        assert h.content_hash() != h2.content_hash()

    def test_content_hash_ignores_label(self) -> None:
        """A pure-label rename must not change the structural hash."""
        h = _strict_harness()
        h_renamed = HarnessConfig(
            harness_id=h.harness_id,
            label="totally-different-display-name",
            permission_tier=h.permission_tier,
            tools_available=h.tools_available,
            state_recovery=h.state_recovery,
            tracing=h.tracing,
        )
        assert h.content_hash() == h_renamed.content_hash()

    def test_content_hash_ignores_tool_order(self) -> None:
        h = _strict_harness()
        reordered = HarnessConfig(
            harness_id=h.harness_id,
            label=h.label,
            permission_tier=h.permission_tier,
            tools_available=tuple(reversed(h.tools_available)),
            state_recovery=h.state_recovery,
            tracing=h.tracing,
        )
        assert h.content_hash() == reordered.content_hash()


class TestHarnessConfigDiff:
    def test_no_diff_when_both_sides_match(self) -> None:
        d = diff_harness_configs(_strict_harness(), _strict_harness())
        assert d.shared_harness
        assert d.delta is None

    def test_diff_picks_up_tier_and_tool_changes(self) -> None:
        d = diff_harness_configs(_strict_harness(), _permissive_harness())
        assert not d.shared_harness
        assert d.delta is not None
        assert d.delta.permission_tier_changed
        added_names = {t.name for t in d.delta.added_tools}
        assert added_names == {"http_request"}
        assert d.delta.removed_tools == ()
        assert d.delta.state_recovery_changed

    def test_one_side_missing_emits_no_delta(self) -> None:
        d = diff_harness_configs(_strict_harness(), None)
        assert d.delta is None
        assert not d.shared_harness
        assert d.is_present


# ---------------------------------------------------------------------------
# EvalRunSummary — backward compatibility
# ---------------------------------------------------------------------------


class TestEvalRunSummaryBackCompat:
    def _summary(self, **overrides: Any) -> EvalRunSummary:
        base = {
            "run_id": "run_test",
            "dataset_name": "ds",
            "total_tasks": 0,
            "passed_tasks": 0,
            "failed_tasks": 0,
            "average_score": 0.0,
            "total_cost_cents": 0.0,
            "total_input_tokens": 0,
            "total_output_tokens": 0,
            "total_execution_time_ms": 0,
            "results": [],
            "started_at": datetime.now(tz=UTC),
        }
        base.update(overrides)
        return EvalRunSummary(**base)

    def test_summary_without_harness_omits_keys(self) -> None:
        d = self._summary().to_dict()
        assert "harness_config" not in d
        assert "model" not in d

    def test_summary_with_harness_emits_full_shape(self) -> None:
        s = self._summary(model="claude-opus-4-7", harness_config=_strict_harness())
        d = s.to_dict()
        assert d["model"] == "claude-opus-4-7"
        assert d["harness_config"]["harness_id"] == "strict-no-net"
        assert d["harness_config"]["anchor"] == HARNESS_BENCH_ANCHOR


# ---------------------------------------------------------------------------
# DeltaReport — per-side harness + group label
# ---------------------------------------------------------------------------


def _fixture_pair() -> tuple[dict[str, Any], dict[str, Any]]:
    with FIXTURE_PATH.open() as fh:
        data = json.load(fh)
    return data["baseline"], data["current"]


class TestDeltaReportHarness:
    def test_execution_alignment_failure_score_gap(self) -> None:
        """Same model, two harnesses → different aggregate scores.

        This is the Harness-Bench "execution-alignment failure" point: if a
        report only labels the model, the score gap is invisible. The fixture
        deliberately makes the strict harness fail tasks 2 and 3 because the
        denied `http_request` tool blocks the agent.
        """
        baseline, current = _fixture_pair()
        baseline_pass = sum(1 for r in baseline["task_results"] if r["passed"])
        current_pass = sum(1 for r in current["task_results"] if r["passed"])

        assert baseline["model"] == current["model"], "same model both sides"
        assert baseline_pass == 1
        assert current_pass == 3
        assert baseline_pass != current_pass, "harness alone changes the outcome"

    def test_delta_report_carries_per_side_harness(self) -> None:
        baseline, current = _fixture_pair()
        report = DeltaReporter().compare_runs(baseline, current)

        assert report.baseline_model == "claude-opus-4-7"
        assert report.current_model == "claude-opus-4-7"
        assert report.baseline_harness_config is not None
        assert report.current_harness_config is not None
        assert report.baseline_harness_config.harness_id == "strict-no-net"
        assert report.current_harness_config.harness_id == "permissive-with-net"

    def test_harness_diff_surfaces_added_tool_and_tier(self) -> None:
        baseline, current = _fixture_pair()
        report = DeltaReporter().compare_runs(baseline, current)

        diff = report.harness_diff
        assert not diff.shared_harness, "fixture is execution-alignment failure"
        assert diff.delta is not None
        assert diff.delta.permission_tier_changed
        added = {t.name for t in diff.delta.added_tools}
        assert "http_request" in added
        assert diff.delta.state_recovery_changed

    def test_group_labels_combine_model_and_harness(self) -> None:
        baseline, current = _fixture_pair()
        report = DeltaReporter().compare_runs(baseline, current)
        assert report.baseline_group_label == "claude-opus-4-7 × strict-policy-no-net"
        assert report.current_group_label == "claude-opus-4-7 × permissive-policy-with-net"

    def test_to_dict_round_trip_preserves_harness(self) -> None:
        baseline, current = _fixture_pair()
        report = DeltaReporter().compare_runs(baseline, current)
        round_tripped = DeltaReport.from_dict(report.to_dict())

        assert round_tripped.baseline_harness_config == report.baseline_harness_config
        assert round_tripped.current_harness_config == report.current_harness_config
        assert round_tripped.baseline_model == report.baseline_model

    def test_legacy_report_without_harness_loads_clean(self) -> None:
        """Reports written before this PR omit the harness keys entirely; the
        loader must accept them and surface a clean `(no harness)` label."""
        baseline = {
            "run_id": "run_legacy",
            "task_results": [
                {"task_id": "t1", "passed": True, "scorer_results": {}},
            ],
            "version": "0.1.0",
        }
        current = {
            "run_id": "run_legacy_current",
            "task_results": [
                {"task_id": "t1", "passed": True, "scorer_results": {}},
            ],
            "version": "0.1.0",
        }
        report = DeltaReporter().compare_runs(baseline, current)

        assert report.baseline_harness_config is None
        assert report.current_harness_config is None
        assert report.harness_diff.delta is None
        assert "(no harness)" in report.baseline_group_label


# ---------------------------------------------------------------------------
# Label helper
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("model", "harness", "expected"),
    [
        ("claude-opus-4-7", _strict_harness(), "claude-opus-4-7 × strict-policy-no-net"),
        (None, _strict_harness(), "unknown-model × strict-policy-no-net"),
        ("gpt-4o", None, "gpt-4o × (no harness)"),
        (None, None, "unknown-model × (no harness)"),
    ],
)
def test_label_for_model_harness(
    model: str | None, harness: HarnessConfig | None, expected: str
) -> None:
    assert label_for_model_harness(model, harness) == expected
