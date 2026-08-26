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
from datetime import UTC, datetime, timedelta
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


# ---------------------------------------------------------------------------
# Staleness: the MAX_AGE_DAYS limit
#
# The gap: `asb`, `injection_defense` and `governed-benchmark` back the README's
# security numbers, and the page rendered "pass / 2 consecutive passes" for all
# three while their most recent committed report was sixteen days old. Nothing
# in the table carried an age, so a figure measured this morning and one
# measured a fortnight ago looked identical.
# ---------------------------------------------------------------------------

EvalHealth = gen_eval_health.EvalHealth
RunRecord = gen_eval_health.RunRecord

NOW = datetime(2026, 8, 26, 12, 0, tzinfo=UTC)


def _bucket(name: str, days_ago: int, *, passed: bool = True) -> EvalHealth:
    """One eval whose single committed report is `days_ago` days old."""
    when = NOW - timedelta(days=days_ago)
    return EvalHealth(
        name=name,
        description="test",
        runs=[
            RunRecord(
                eval_name=name,
                when=when,
                passed=passed,
                score=1.0,
                detail="block 100%",
                source=f"{name}-{when:%Y%m%d}.json",
            )
        ],
    )


def test_a_fresh_headline_eval_is_not_stale() -> None:
    assert not _bucket("asb", 1).is_stale(NOW)


def test_the_limit_is_inclusive_at_the_boundary() -> None:
    # Exactly MAX_AGE_DAYS old is still fine; one day past it is not. Pinned
    # because an off-by-one here either fires a day early (noise, and a noisy
    # gate gets deleted) or a day late (the thing it exists to catch).
    limit = gen_eval_health.MAX_AGE_DAYS
    assert not _bucket("asb", limit).is_stale(NOW)
    assert _bucket("asb", limit + 1).is_stale(NOW)


def test_the_sixteen_day_gap_that_prompted_this_would_now_be_caught() -> None:
    # The real state on 2026-08-26: last committed report 2026-08-22 for each of
    # the three. That was four days old and legitimately fine. The failure was
    # the SIXTEEN-day window with two runs in it -- so this pins the shape that
    # was actually dangerous.
    for name in ("asb", "injection_defense", "governed-benchmark"):
        assert _bucket(name, 16).is_stale(NOW), f"{name} at 16 days must be stale"


def test_nightly_suites_are_exempt() -> None:
    # `smoke` and `regression` commit their own reports on a cron, so their age
    # is already self-evident in the table. A second gate would only add noise.
    assert not _bucket("smoke", 99).is_stale(NOW)
    assert not _bucket("regression", 99).is_stale(NOW)


def test_an_eval_that_never_ran_is_not_reported_as_stale() -> None:
    # Never-run is a different and already-fatal condition. Reporting it as
    # staleness would blur two failures the page deliberately keeps apart.
    empty = EvalHealth(name="asb", description="test")
    assert empty.age_days(NOW) is None
    assert not empty.is_stale(NOW)


def test_a_stale_eval_does_not_render_as_a_passing_row() -> None:
    # The whole point: the row must stop saying "pass". The score stays --- it
    # was really measured --- but the result column reports the age instead of
    # asserting the figure still holds.
    health = {"asb": _bucket("asb", 30)}
    page = gen_eval_health.render(health, NOW)
    row = next(line for line in page.splitlines() if line.startswith("| `asb`"))
    assert "**STALE**" in row
    assert "| pass |" not in row
    assert "30 days old" in row
    # And it is explained below the table, not just marked in it.
    assert "Evals whose evidence has gone stale" in page


def test_a_fresh_eval_still_renders_as_a_pass() -> None:
    health = {"asb": _bucket("asb", 1)}
    page = gen_eval_health.render(health, NOW)
    row = next(line for line in page.splitlines() if line.startswith("| `asb`"))
    assert "pass" in row
    assert "STALE" not in row
    assert "Evals whose evidence has gone stale" not in page


def test_release_mode_exits_non_zero_on_a_stale_headline_eval(tmp_path: Path) -> None:
    """The gate, end to end through the CLI.

    A check that cannot fail is the bug it exists to catch, so this drives the
    real entry point rather than the predicate.
    """
    out = tmp_path / "eval-health.md"
    result = subprocess.run(
        [
            sys.executable,
            str(REPO_ROOT / "scripts" / "gen_eval_health.py"),
            "--release",
            "--max-age-days",
            "-1",  # everything committed today is over this line
            "--out",
            str(out),
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1, result.stdout + result.stderr
    assert "STALE" in result.stderr
    # It must point at the likely cause, not just the symptom: these run on
    # every push, so stale evidence usually means something stopped COMMITTING
    # the report rather than that the eval stopped running.
    assert "stopped committing" in result.stderr
    # The page is written even on the failing run --- a gate that aborts before
    # publishing leaves the last green page in place.
    assert out.exists()
    assert "**STALE**" in out.read_text()


def test_release_mode_is_green_on_the_repo_as_committed(tmp_path: Path) -> None:
    """Guards the state this branch put the repo into.

    If this starts failing, the three headline evals have gone stale again ---
    which is the signal, not a broken test.
    """
    out = tmp_path / "eval-health.md"
    result = subprocess.run(
        [
            sys.executable,
            str(REPO_ROOT / "scripts" / "gen_eval_health.py"),
            "--release",
            "--out",
            str(out),
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr

