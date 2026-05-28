"""Tests for the bench-audit pre-flight (ABA, arXiv:2605.26079)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from fd_evals.bench_audit import (
    BENCH_AUDIT_ANCHOR,
    BenchAuditor,
    FlagSeverity,
    HygieneClass,
    load_report,
    save_report,
)
from fd_evals.task import EvalTask

# -----------------------------------------------------------------------------
# Fixtures
# -----------------------------------------------------------------------------


def _clean_task(task_id: str, target_module: str = "foo") -> EvalTask:
    """A well-formed task with no hygiene issues.

    Each call must return a distinct ``input`` payload — the auditor flags
    duplicate inputs as a suspect-truth signal, so the fixture parameterises
    the target module to keep specs unique.
    """
    return EvalTask(
        id=task_id,
        name=f"Task {task_id}",
        description=f"Detailed description for {task_id}",
        input={
            "task": f"Add a docstring to the {target_module}() function in src/{target_module}.py",
            "repo": "example/project",
            "branch": "main",
        },
        expected={
            "files_changed": [f"src/{target_module}.py"],
            "pr_created": True,
            "tests_pass": True,
        },
        difficulty="easy",
        category="documentation",
    )


@pytest.fixture
def clean_tasks() -> list[EvalTask]:
    """A clean suite with three well-formed, *distinct* tasks."""
    return [_clean_task(f"task_{i:03d}", f"module_{i}") for i in range(1, 4)]


@pytest.fixture
def ambiguous_grading_tasks() -> list[EvalTask]:
    """A suite seeded with brittle-grading + ambiguous-spec issues."""
    return [
        # Orphan expected keys (silent-pass risk).
        EvalTask(
            id="task_brittle_001",
            name="Brittle 1",
            description="Brittle grading task",
            input={"task": "Fix the bug in src/bar.py", "repo": "x/y", "branch": "main"},
            expected={
                "some_undocumented_metric": True,
                "another_orphan_key": "value",
                "third_orphan": 1,
                "fourth_orphan": False,
            },
        ),
        # Conflicting regex+contains graders on the same task.
        EvalTask(
            id="task_brittle_002",
            name="Brittle 2",
            description="Brittle grading task",
            input={"task": "Refactor the helper", "repo": "x/y", "branch": "main"},
            expected={"regex": "^foo.*", "contains": ["bar"]},
        ),
        # Vague spec full of placeholders.
        EvalTask(
            id="task_ambig_001",
            name="Ambig 1",
            description="Ambiguous task",
            input={
                "task": "Do this thing with <TARGET_FILE> appropriately",
                "repo": "x/y",
                "branch": "main",
            },
            expected={"files_changed": ["src/x.py"], "pr_created": True},
        ),
    ]


# -----------------------------------------------------------------------------
# Clean-suite path
# -----------------------------------------------------------------------------


class TestCleanSuite:
    def test_clean_suite_has_high_trust(self, clean_tasks: list[EvalTask]) -> None:
        auditor = BenchAuditor()
        report = auditor.audit_tasks(clean_tasks, suite_id="clean")

        assert report.bench_trust_score >= 0.85
        assert report.flagged_task_ids == []
        assert report.total_tasks == len(clean_tasks)
        assert report.anchor == BENCH_AUDIT_ANCHOR

    def test_clean_suite_class_scores_all_one(self, clean_tasks: list[EvalTask]) -> None:
        report = BenchAuditor().audit_tasks(clean_tasks, suite_id="clean")
        for cls in HygieneClass:
            assert report.hygiene_class_scores[cls.value] == pytest.approx(1.0)

    def test_report_dict_round_trip(self, clean_tasks: list[EvalTask]) -> None:
        report = BenchAuditor().audit_tasks(clean_tasks, suite_id="clean")
        round_tripped = type(report).from_dict(report.to_dict())
        assert round_tripped.suite_id == report.suite_id
        # to_dict rounds to 4 dp for stable JSON output; tolerate that here.
        assert round_tripped.bench_trust_score == pytest.approx(report.bench_trust_score, abs=1e-4)
        assert round_tripped.flagged_task_ids == report.flagged_task_ids
        assert round_tripped.anchor == BENCH_AUDIT_ANCHOR


# -----------------------------------------------------------------------------
# Dirty-suite path — the gate must block
# -----------------------------------------------------------------------------


class TestAmbiguousGradingSuite:
    def test_score_drops_below_default_threshold(
        self, ambiguous_grading_tasks: list[EvalTask]
    ) -> None:
        auditor = BenchAuditor()
        report = auditor.audit_tasks(ambiguous_grading_tasks, suite_id="brittle")

        # Threshold mirrors the Rust default (`min_trust_score = 0.70`) and the
        # CLI's `--min-trust 0.70` default.
        assert report.bench_trust_score < 0.70
        # Every dirty task in the fixture should be flagged.
        assert set(report.flagged_task_ids) == {
            "task_brittle_001",
            "task_brittle_002",
            "task_ambig_001",
        }

    def test_orphan_expected_keys_flagged_as_brittle_grading(
        self, ambiguous_grading_tasks: list[EvalTask]
    ) -> None:
        report = BenchAuditor().audit_tasks(ambiguous_grading_tasks, suite_id="brittle")
        brittle = [f for f in report.task_flags if f.hygiene_class == HygieneClass.BRITTLE_GRADING]
        # task_brittle_001 (4 orphan keys → high) + task_brittle_002 (regex+contains
        # mix → medium).
        sources = {(f.task_id, f.severity) for f in brittle}
        assert ("task_brittle_001", FlagSeverity.HIGH) in sources
        assert ("task_brittle_002", FlagSeverity.MEDIUM) in sources

    def test_placeholders_and_vague_tokens_flagged_as_ambiguous(
        self, ambiguous_grading_tasks: list[EvalTask]
    ) -> None:
        report = BenchAuditor().audit_tasks(ambiguous_grading_tasks, suite_id="brittle")
        ambig = [
            f
            for f in report.task_flags
            if f.hygiene_class == HygieneClass.AMBIGUOUS_SPEC and f.task_id == "task_ambig_001"
        ]
        # Should pick up at least the placeholder and the vague-token hits.
        evidences = " ".join(f.evidence for f in ambig)
        assert "placeholder" in evidences or "vague" in evidences


# -----------------------------------------------------------------------------
# Targeted per-class checks
# -----------------------------------------------------------------------------


class TestPerClassDetectors:
    def test_empty_expected_is_suspect_truth(self) -> None:
        task = EvalTask(
            id="empty_truth",
            name="Empty truth",
            description="No ground truth",
            input={"task": "Add a README badge", "repo": "x/y"},
            expected={},
        )
        report = BenchAuditor().audit_tasks([task], suite_id="solo")
        flags = [f for f in report.task_flags if f.task_id == "empty_truth"]
        assert any(
            f.hygiene_class == HygieneClass.SUSPECT_TRUTH and f.severity == FlagSeverity.HIGH
            for f in flags
        )

    def test_wildcard_path_in_truth_is_flagged(self) -> None:
        task = EvalTask(
            id="wildcard_truth",
            name="Wildcard truth",
            description="Loose truth",
            input={"task": "Create an Alembic migration", "repo": "x/y"},
            expected={
                "files_changed": ["alembic/versions/*.py", "src/models/user.py"],
                "pr_created": True,
            },
        )
        report = BenchAuditor().audit_tasks([task], suite_id="solo")
        suspect = [
            f
            for f in report.task_flags
            if f.task_id == "wildcard_truth" and f.hygiene_class == HygieneClass.SUSPECT_TRUTH
        ]
        assert any("wildcard" in f.evidence for f in suspect)

    def test_undeclared_env_var_is_env_conflict(self) -> None:
        task = EvalTask(
            id="env_task",
            name="Env conflict",
            description="Uses undeclared env",
            input={
                "task": "Configure the deploy using $SECRET_TOKEN and ${API_HOST}",
                "repo": "x/y",
                "branch": "main",
            },
            expected={"files_changed": ["deploy.yml"], "pr_created": True},
        )
        report = BenchAuditor().audit_tasks([task], suite_id="solo")
        env_flags = [f for f in report.task_flags if f.hygiene_class == HygieneClass.ENV_CONFLICT]
        assert len(env_flags) >= 2

    def test_undeclared_env_var_passes_when_declared(self) -> None:
        task = EvalTask(
            id="env_task",
            name="Env declared",
            description="Declares its env",
            input={"task": "Configure the deploy using $SECRET_TOKEN", "repo": "x/y"},
            expected={"files_changed": ["deploy.yml"], "pr_created": True},
        )
        report = BenchAuditor(declared_env_vars={"SECRET_TOKEN"}).audit_tasks(
            [task], suite_id="solo"
        )
        env_flags = [f for f in report.task_flags if f.hygiene_class == HygieneClass.ENV_CONFLICT]
        assert env_flags == []

    def test_too_short_spec_is_ambiguous(self) -> None:
        task = EvalTask(
            id="short",
            name="Short",
            description="x",
            input={"task": "go"},
            expected={"files_changed": ["a.py"], "pr_created": True},
        )
        report = BenchAuditor().audit_tasks([task], suite_id="solo")
        ambig = [
            f
            for f in report.task_flags
            if f.hygiene_class == HygieneClass.AMBIGUOUS_SPEC and f.severity == FlagSeverity.HIGH
        ]
        assert ambig, "short spec must produce a high-severity ambiguity flag"

    def test_duplicate_ids_flagged_high(self) -> None:
        a = _clean_task("dup_001")
        b = _clean_task("dup_001")
        report = BenchAuditor().audit_tasks([a, b], suite_id="dup")
        dups = [
            f
            for f in report.task_flags
            if f.hygiene_class == HygieneClass.SUSPECT_TRUTH and f.severity == FlagSeverity.HIGH
        ]
        assert any("duplicate task id" in f.evidence for f in dups)


# -----------------------------------------------------------------------------
# IO + dataset loader
# -----------------------------------------------------------------------------


class TestPersistence:
    def test_save_and_load_round_trip(self, clean_tasks: list[EvalTask], tmp_path: Path) -> None:
        report = BenchAuditor().audit_tasks(clean_tasks, suite_id="clean")
        out = tmp_path / "bench_audit.json"
        save_report(report, out)

        round_tripped = load_report(out)
        assert round_tripped.bench_trust_score == pytest.approx(report.bench_trust_score, abs=1e-4)
        assert round_tripped.anchor == BENCH_AUDIT_ANCHOR

    def test_audit_dataset_jsonl(self, tmp_path: Path) -> None:
        path = tmp_path / "tasks.jsonl"
        with path.open("w") as fh:
            fh.write(
                json.dumps(
                    {
                        "id": "t1",
                        "name": "T1",
                        "description": "Add a docstring to the foo function in src/foo.py",
                        "input": {
                            "task": "Add a docstring to the foo function in src/foo.py",
                            "repo": "x/y",
                            "branch": "main",
                        },
                        "expected": {
                            "files_changed": ["src/foo.py"],
                            "pr_created": True,
                        },
                    }
                )
                + "\n"
            )

        report = BenchAuditor().audit_dataset(path, suite_id="solo")
        assert report.total_tasks == 1
        assert report.bench_trust_score == pytest.approx(1.0)


# -----------------------------------------------------------------------------
# Existing safe-pr-agent dataset must remain clean (catch regressions)
# -----------------------------------------------------------------------------


def test_shipped_safe_pr_agent_dataset_passes_default_threshold() -> None:
    """The dataset shipped in `evals/` must satisfy the default trust gate."""
    repo_root = Path(__file__).resolve().parents[4]
    dataset_path = repo_root / "evals" / "datasets" / "safe-pr-agent" / "tasks.jsonl"
    if not dataset_path.exists():
        pytest.skip(f"dataset not present at {dataset_path}")

    report = BenchAuditor().audit_dataset(dataset_path, suite_id="safe-pr-agent")
    assert report.bench_trust_score >= 0.70, (
        f"shipped dataset dropped below 0.70 trust ({report.bench_trust_score:.4f}); "
        f"flagged ids: {report.flagged_task_ids}"
    )
