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
        assert suite.scorer_names == ["no_policy_violations", "expected_output_match"]
        assert len(suite.scorers) == 2

    def test_no_suite_declares_a_scorer_that_can_never_fire(self, realistic_context):
        """A declared scorer that skips on every task is a claim, not a check.

        ``schema_valid`` sat in both suites while no task in the dataset
        declared an ``output_schema``, so it skipped every time and handed back
        a full score for having nothing to do. That is half of why the suites
        reported 1.00.
        """
        for name in ("smoke", "regression"):
            suite = load_suite(name, evals_dir=_evals_dir())
            tasks = [
                t
                for t in EvalRunner.load_tasks(suite.dataset_path)
                if suite.matches(t.category, t.tags)
            ]
            assert tasks, f"{name} must select at least one task"

            for scorer in suite.scorers:
                fired = any(
                    not scorer.score(t, "x" * 900, realistic_context).skipped for t in tasks
                )
                assert fired, (
                    f"{name}.yaml declares {scorer.name}, which skips on every task in its "
                    f"dataset. Remove it or give the dataset something for it to assert on."
                )

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

        # A response of the length the committed runs actually show (195-381
        # output tokens, so ~800-1500 characters).
        agent_output = (
            "Added a CI status badge to the top of README.md. "
            "The badge points at the GitHub Actions workflow and renders the "
            "current status of the default branch. " + ("Details follow. " * 40)
        )
        scores = [composite.score(t, agent_output, realistic_context).score for t in selected]

        assert all(s > 0.0 for s in scores), (
            "every task scoring 0 means the harness cannot observe what it asserts on "
            "-- this is the #31 failure mode, not an agent regression"
        )
        assert sum(scores) / len(scores) > 0.5

    def test_a_degenerate_response_fails_rather_than_scoring_full_marks(self, realistic_context):
        """The other direction of #31: a false green.

        Before skips were excluded from the average, both suites reported a flat
        1.00 while half of every run's scorer results asserted nothing. A run
        that produced almost no output scored exactly the same as one that did
        the work, because the scorers that could have told them apart had
        nothing declared to check.
        """
        suite = load_suite("smoke", evals_dir=_evals_dir())
        composite = CompositeScorer(
            suite.scorers,
            name="EvalScorer",
            require_all_pass=suite.require_all_scorers_pass,
        )
        tasks = [
            t
            for t in EvalRunner.load_tasks(suite.dataset_path)
            if suite.matches(t.category, t.tags)
        ]

        result = composite.score(tasks[0], "no.", realistic_context)
        assert not result.passed, "a near-empty response must not be reported as a pass"
        assert result.score < 1.0
        assert result.details["assertion_coverage"] == 1.0, (
            "every declared scorer must have actually run -- otherwise this test "
            "is only measuring the ones that happened to fire"
        )

    def test_default_scorers_score_zero_on_a_real_context(self, realistic_context):
        """Documents *why* the defaults must not be used for a real run.

        All three artifact scorers read keys the control plane never surfaces,
        so none of them can pass. The old figure here was 0.125, and every
        point of it came from ``LintScorer`` skipping -- it had nothing to
        check and returned a full score at 0.5 of 4.0 total weight. With skips
        excluded from the average that vacuous contribution is gone and the
        honest number is 0.0: on a real run these scorers observe nothing.
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
        assert result.score == pytest.approx(0.0), (
            "if this changes, the run-context contract moved -- re-check which "
            "fields the artifact scorers can actually see"
        )
        assert "LintScorer" in result.details["skipped_scorers"], (
            "LintScorer was the entire source of the old 0.125; if it now asserts, "
            "the 0.0 above needs re-deriving rather than re-baselining"
        )

    def test_the_safe_pr_dataset_expectations_are_reported_as_unasserted(self):
        """The (c) detector, pinned on the case that motivated it.

        The dataset expects files changed, a PR opened and tests passing
        against ``example/project``, a repo that does not exist and that this
        control plane never clones. No scorer reads those keys. The harness has
        to say so rather than scoring around them.
        """
        suite = load_suite("regression", evals_dir=_evals_dir())
        tasks = EvalRunner.load_tasks(suite.dataset_path)
        unasserted = suite.unasserted_expectations(tasks)

        for key in ("files_changed", "pr_created", "tests_pass"):
            assert key in unasserted, f"{key} is declared by the dataset and read by no scorer"
        assert unasserted["files_changed"] == len(tasks), "every task declares it"

        # And the keys a scorer does read must not be listed.
        assert "min_length" not in unasserted
