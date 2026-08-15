"""Tests for scripts/gen_eval_health.py.

The bug these pin: `evals/reports/*.json` is gitignored, so a working copy
normally holds local run output that is not in the repository. The generator
originally globbed the directory, which meant the published page depended on
whichever runs happened to be sitting on the author's disk -- inflating the
consecutive-pass counts with evidence nobody else could see, and making
`--check` fail spuriously for any developer who had ever run an eval.

The page is published as evidence for the eval-gating claim, so it must be
derived only from evidence that is actually committed.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
_SPEC = importlib.util.spec_from_file_location(
    "gen_eval_health", REPO_ROOT / "scripts" / "gen_eval_health.py"
)
assert _SPEC and _SPEC.loader
gen_eval_health = importlib.util.module_from_spec(_SPEC)
sys.modules["gen_eval_health"] = gen_eval_health
_SPEC.loader.exec_module(gen_eval_health)


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True)


@pytest.fixture
def repo_with_ignored_reports(tmp_path: Path) -> Path:
    """A git repo where reports are gitignored and only some are tracked."""
    _git(tmp_path, "init", "-q")
    _git(tmp_path, "config", "user.email", "t@example.com")
    _git(tmp_path, "config", "user.name", "t")

    reports = tmp_path / "evals" / "reports"
    reports.mkdir(parents=True)
    (tmp_path / ".gitignore").write_text("evals/reports/*.json\n")

    def write(name: str, block: float) -> Path:
        p = reports / name
        p.write_text(
            json.dumps(
                {
                    "suite": "asb",
                    "block_rate_under_attack": {"rate": block},
                    "benign_utility": {"rate": 1.0},
                    "corpus_parity_ok": True,
                    "mismatches": [],
                }
            )
        )
        return p

    tracked = write("asb-20260810.json", 1.0)
    # Three local-only runs the rest of the world cannot see.
    write("asb-20260701.json", 1.0)
    write("asb-20260702.json", 1.0)
    write("asb-20260703.json", 1.0)

    _git(tmp_path, "add", ".gitignore")
    _git(tmp_path, "add", "-f", str(tracked.relative_to(tmp_path)))
    _git(tmp_path, "commit", "-q", "-m", "init")
    return tmp_path


class TestTrackedReports:
    def test_only_tracked_reports_are_read(self, repo_with_ignored_reports, monkeypatch):
        monkeypatch.chdir(repo_with_ignored_reports)
        found = gen_eval_health.tracked_reports(Path("evals/reports"))

        assert len(found) == 1, f"expected only the tracked report, got {found}"
        assert found[0].name == "asb-20260810.json"

    def test_streak_counts_only_committed_evidence(self, repo_with_ignored_reports, monkeypatch):
        """Four passing runs on disk, one committed -> the page must say 1."""
        monkeypatch.chdir(repo_with_ignored_reports)
        health = gen_eval_health.collect(Path("evals/reports"))

        assert health["asb"].consecutive_passes == 1, (
            "untracked local runs must not inflate the published streak"
        )

    def test_falls_back_to_glob_outside_a_git_repo(self, tmp_path, monkeypatch):
        """A source tarball has no git; a slightly wrong page beats no page."""
        reports = tmp_path / "evals" / "reports"
        reports.mkdir(parents=True)
        (reports / "asb-20260810.json").write_text("{}")
        monkeypatch.chdir(tmp_path)

        found = gen_eval_health.tracked_reports(Path("evals/reports"))
        assert [p.name for p in found] == ["asb-20260810.json"]


class TestNeverPassedIsStated:
    def test_an_eval_with_no_report_says_so(self):
        """The whole point of the page: a gap is stated, not omitted."""
        rendered = gen_eval_health.render(
            {
                "regression": gen_eval_health.EvalHealth(
                    name="regression", description="full regression"
                )
            },
            datetime.now(tz=UTC),
        )
        assert "NEVER RUN" in rendered
        assert "Evals with no passing run" in rendered

    def test_a_failing_eval_with_no_pass_in_history_says_never_passed(self):
        bucket = gen_eval_health.EvalHealth(name="smoke", description="smoke")
        bucket.runs.append(
            gen_eval_health.RunRecord(
                eval_name="smoke",
                when=datetime(2026, 8, 1, tzinfo=UTC),
                passed=False,
                score=0.12,
                detail="0/20 tasks passed",
                source="eval_smoke.json",
            )
        )
        rendered = gen_eval_health.render({"smoke": bucket}, datetime.now(tz=UTC))
        assert "NEVER PASSED" in rendered
        assert "no passing run in 1 recorded run(s)" in rendered


def test_committed_page_matches_the_generator():
    """docs/eval-health.md must be regenerable from tracked reports alone."""
    result = subprocess.run(
        [sys.executable, "scripts/gen_eval_health.py", "--check"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"page is stale: {result.stdout}{result.stderr}"
