"""Regression tests for the suite-loading path that caused issue #31.

The nightly safe-PR eval scored exactly 0.12 on every task for forty
consecutive runs. The cause was not the agent: ``cli.get_default_scorers()``
was hardcoded and the ``scorers:``/``filter:`` blocks in ``evals/suites/*.yaml``
were parsed and discarded, so three of the four scorers actually used read
``run_context`` keys that the real ``_build_run_context`` never populated.
Their combined weight was 0.5 out of 4.0 -> 0.125 -> "0.12", on every task,
regardless of what the agent did.

These tests pin the three things that have to stay true for that not to recur.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from fd_evals.runner import EvalRunner
from fd_evals.scorers.base import CompositeScorer
from fd_evals.suite import SCORER_REGISTRY, SuiteError, build_scorer, load_suite
from fd_evals.task import EvalTask

REPO_ROOT = Path(__file__).resolve().parents[4]


def _evals_dir() -> Path:
    return REPO_ROOT / "evals"


@pytest.fixture
def realistic_context() -> dict:
    """A run context shaped like a real completed run, via the real builder."""
    runner = EvalRunner(scorers=[], control_plane_url="http://localhost:8080")
    ctx = runner._build_run_context(
        {
            "status": "completed",
            "input_tokens": 800,
            "output_tokens": 166,
            "tool_calls": 2,
            "cost_cents": 2.0,
            "trace_id": "trace_test",
        }
    )
    runner._enrich_context_from_steps(
        ctx,
        [
            {"id": "stp_1", "step_type": "LLM", "status": "completed", "duration_ms": 4200},
            {
                "id": "stp_2",
                "step_type": "TOOL",
                "tool_name": "read_file",
                "status": "completed",
                "policy_decision": {"kind": "allow"},
                "duration_ms": 120,
            },
        ],
    )
    return ctx


class TestSuiteLoading:
    def test_smoke_suite_applies_its_category_filter(self):
        """smoke.yaml filters to documentation; it must not run all 20 tasks."""
        suite = load_suite("smoke", evals_dir=_evals_dir())
        assert suite.categories == ["documentation"]

        tasks = EvalRunner(scorers=[]).load_tasks(suite.dataset_path)
        selected = [t for t in tasks if suite.matches(t.category, t.tags)]

        assert len(tasks) > len(selected), "filter must actually narrow the dataset"
        assert all(t.category == "documentation" for t in selected)

    def test_suite_scorers_are_loaded_not_discarded(self):
        """The assertions a suite declares are the ones that run."""
        suite = load_suite("smoke", evals_dir=_evals_dir())
        assert suite.scorer_names == ["schema_valid", "no_policy_violations"]
        assert len(suite.scorers) == 2

    def test_regression_suite_scorers_all_resolve(self):
        """regression.yaml referenced expected_output_match, which had no class."""
        suite = load_suite("regression", evals_dir=_evals_dir())
        assert "expected_output_match" in suite.scorer_names
        assert len(suite.scorers) == len(suite.scorer_names)

    def test_unknown_scorer_raises_instead_of_silently_substituting(self):
        """Silent substitution is what hid #31 for forty runs."""
        with pytest.raises(SuiteError, match="Unknown scorer"):
            build_scorer({"type": "definitely_not_a_scorer"})

    def test_missing_suite_raises(self):
        with pytest.raises(SuiteError):
            load_suite("no_such_suite", evals_dir=_evals_dir())

    def test_every_registry_entry_is_constructible(self):
        for name in SCORER_REGISTRY:
            built_name, scorer = build_scorer({"type": name})
            assert built_name == name
            assert scorer is not None


class TestRunContextContract:
    def test_tool_calls_is_a_list_not_a_count(self, realistic_context):
        """Policy/allowlist scorers iterate tool_calls; an int made them vacuous."""
        assert isinstance(realistic_context["tool_calls"], list)
        assert realistic_context["tool_call_count"] == 1
        assert realistic_context["tool_calls"][0]["name"] == "read_file"

    def test_steps_populate_audit_events_and_duration(self, realistic_context):
        assert realistic_context["audit_events"], "policy decisions must reach the scorers"
        assert realistic_context["execution_time_ms"] == 4320


class TestSafePrScoringRegression:
    """The actual #31 symptom, pinned so it cannot silently return."""

    def test_suite_scorers_produce_a_nonzero_score(self, realistic_context):
        suite = load_suite("smoke", evals_dir=_evals_dir())
        composite = CompositeScorer(suite.scorers, name="EvalScorer", require_all_pass=False)

        tasks = EvalRunner(scorers=[]).load_tasks(suite.dataset_path)
        selected = [t for t in tasks if suite.matches(t.category, t.tags)]
        assert selected, "smoke must select at least one task"

        agent_output = "Added a CI status badge to the top of README.md."
        scores = [composite.score(t, agent_output, realistic_context).score for t in selected]

        assert all(s > 0.0 for s in scores), (
            "every task scoring 0 means the harness cannot observe what it asserts on "
            "-- this is the #31 failure mode, not an agent regression"
        )
        assert sum(scores) / len(scores) > 0.5

    def test_default_scorers_are_capped_at_0125_on_a_real_context(self, realistic_context):
        """Documents *why* the defaults must not be used for a real run.

        Three of the four read keys the control plane never surfaces, so the
        best achievable score is LintScorer's 0.5 of 4.0 total weight.
        """
        from fd_evals.cli import get_default_scorers

        composite = CompositeScorer(
            get_default_scorers(), name="EvalScorer", require_all_pass=False
        )
        task = EvalTask(
            id="t1",
            name="Add README badge",
            description="d",
            input={},
            expected={"files_changed": ["README.md"], "pr_created": True, "tests_pass": True},
            category="documentation",
        )
        result = composite.score(task, "some prose from the model", realistic_context)
        assert result.score == pytest.approx(0.125), (
            "if this changes, the run-context contract moved -- re-check which "
            "fields the artifact scorers can actually see"
        )
