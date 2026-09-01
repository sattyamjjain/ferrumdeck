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


# ---------------------------------------------------------------------------
# The append-only measurement series.
#
# The page is a snapshot: today's refresh overwrites yesterday's answer, so a
# number that has held steady for a month and one that has never been
# re-measured render identically. The series is the record that distinguishes
# them, and it is only worth having if it cannot be rewritten.


def _series_repo(tmp_path: Path) -> Path:
    _git(tmp_path, "init", "-q")
    _git(tmp_path, "config", "user.email", "t@example.com")
    _git(tmp_path, "config", "user.name", "t")
    return tmp_path


def test_a_refresh_that_sees_no_new_report_appends_nothing(tmp_path: Path) -> None:
    """The core property: rows are keyed to reports, not to refreshes.

    A refresh on a day when no eval ran must not write a row. If it did, the
    file would fill with restatements of an old measurement, and a row in an
    evidence file reads as a measurement whether or not one happened.
    """
    health = {"asb": _bucket("asb", 1)}
    seen: set[tuple[str, str]] = set()

    first = gen_eval_health.build_series_rows(health, tmp_path, NOW, seen)
    assert len(first) == 1

    # Same health, same seen-set: a second refresh with nothing new.
    second = gen_eval_health.build_series_rows(health, tmp_path, NOW, seen)
    assert second == [], "a refresh with no new report must append nothing"


def test_a_new_report_appends_exactly_one_row(tmp_path: Path) -> None:
    health = {"asb": _bucket("asb", 1)}
    seen: set[tuple[str, str]] = set()
    gen_eval_health.build_series_rows(health, tmp_path, NOW, seen)

    health["asb"].runs.append(
        RunRecord(
            eval_name="asb",
            when=NOW,
            passed=True,
            score=1.0,
            detail="block 100%",
            source="asb-20260826.json",
        )
    )
    added = gen_eval_health.build_series_rows(health, tmp_path, NOW, seen)
    assert [r["report"] for r in added] == ["asb-20260826.json"]


def test_a_row_records_measured_and_observed_separately(tmp_path: Path) -> None:
    """A report committed late must not read as a measurement taken late.

    This is the stale-row hazard: the nightly's commit step runs `if: always()`,
    so it pushes even on a run where the --release staleness gate failed, and
    the commit carries [skip ci] so nothing re-checks it.
    """
    health = {"asb": _bucket("asb", 30)}
    rows = gen_eval_health.build_series_rows(health, tmp_path, NOW, set())
    row = rows[0]

    assert row["measured_at"].startswith("2026-07-27"), "measurement date, from the report"
    assert row["observed_at"].startswith("2026-08-26"), "record date, from the clock"
    assert row["age_at_observation_days"] == 30
    assert row["stale_at_observation"] is True, "a 30-day-old report must be labelled"


def test_a_backfilled_row_is_not_labelled_stale(tmp_path: Path) -> None:
    """Importing history is not the same failure as committing a report late."""
    health = {"asb": _bucket("asb", 30)}
    rows = gen_eval_health.build_series_rows(health, tmp_path, NOW, set(), backfill=True)
    assert rows[0]["backfilled"] is True
    assert rows[0]["stale_at_observation"] is False


def test_exempt_suites_are_never_labelled_stale(tmp_path: Path) -> None:
    health = {"smoke": _bucket("smoke", 30)}
    rows = gen_eval_health.build_series_rows(health, tmp_path, NOW, set())
    assert rows[0]["stale_at_observation"] is False


def test_append_only_guard_accepts_an_append(tmp_path: Path) -> None:
    repo = _series_repo(tmp_path)
    series = repo / "series.jsonl"
    series.write_text('{"suite":"asb","report":"a.json"}\n')
    _git(repo, "add", "series.jsonl")
    _git(repo, "commit", "-qm", "seed")

    with series.open("a") as fh:
        fh.write('{"suite":"asb","report":"b.json"}\n')

    monkey_cwd = Path.cwd()
    try:
        import os

        os.chdir(repo)
        ok, message = gen_eval_health.check_series_append_only(Path("series.jsonl"))
    finally:
        import os

        os.chdir(monkey_cwd)
    assert ok, message
    assert "1 row(s) added" in message


def test_append_only_guard_rejects_a_rewrite(tmp_path: Path) -> None:
    """The one change that makes the whole artifact worthless."""
    repo = _series_repo(tmp_path)
    series = repo / "series.jsonl"
    series.write_text('{"suite":"asb","report":"a.json","score":1.0}\n')
    _git(repo, "add", "series.jsonl")
    _git(repo, "commit", "-qm", "seed")

    # Edit a published row rather than appending a correction.
    series.write_text('{"suite":"asb","report":"a.json","score":0.5}\n')

    import os

    monkey_cwd = Path.cwd()
    try:
        os.chdir(repo)
        ok, message = gen_eval_health.check_series_append_only(Path("series.jsonl"))
    finally:
        os.chdir(monkey_cwd)
    assert not ok
    assert "NOT append-only" in message
    assert "correction_of" in message, "the message must name the correct repair"


def test_append_only_guard_rejects_a_deletion(tmp_path: Path) -> None:
    repo = _series_repo(tmp_path)
    series = repo / "series.jsonl"
    series.write_text('{"r":1}\n{"r":2}\n{"r":3}\n')
    _git(repo, "add", "series.jsonl")
    _git(repo, "commit", "-qm", "seed")
    series.write_text('{"r":1}\n{"r":3}\n')

    import os

    monkey_cwd = Path.cwd()
    try:
        os.chdir(repo)
        ok, _ = gen_eval_health.check_series_append_only(Path("series.jsonl"))
    finally:
        os.chdir(monkey_cwd)
    assert not ok


def test_harness_version_is_read_from_the_producing_commit() -> None:
    """A backfilled row must not be credited to today's harness.

    The 0% and the 1.00 this repo published for the same suite differed because
    the harness changed, not the agent. A series that stamped every historical
    row with the current version would render that as improvement.
    """
    rows = _committed_series()
    versions = {r["harness_version"] for r in rows}
    assert len(versions) > 1, (
        "every row carries the same harness version — the per-commit lookup is "
        f"not working, or has silently fallen back to today's ({versions})"
    )


def _committed_series() -> list[dict]:
    path = REPO_ROOT / gen_eval_health.SERIES_PATH
    if not path.exists():
        pytest.skip(f"{path} not present")
    return gen_eval_health.read_series(path)


def test_the_committed_series_is_well_formed() -> None:
    rows = _committed_series()
    assert rows, "the series must not be empty once committed"
    required = {
        "schema",
        "suite",
        "report",
        "measured_at",
        "observed_at",
        "commit",
        "result",
        "harness_version",
    }
    for i, row in enumerate(rows):
        missing = required - set(row)
        assert not missing, f"row {i} ({row.get('report')}) is missing {sorted(missing)}"


def test_the_committed_series_has_no_duplicate_measurements() -> None:
    """One row per eval run. A duplicate is a restated measurement."""
    rows = _committed_series()
    keys = [gen_eval_health.series_key(r) for r in rows if not r.get("correction_of")]
    dupes = {k for k in keys if keys.count(k) > 1}
    assert not dupes, f"duplicate measurement rows: {sorted(dupes)}"


def test_the_page_shows_the_series_so_a_flat_line_is_visible() -> None:
    page = (REPO_ROOT / "docs" / "eval-health.md").read_text()
    assert "## Recent measurements" in page
    assert "eval-health-series.jsonl" in page
    assert "has not been re-measured" in page, (
        "the page must warn that an unmoving number may be an unmeasured one"
    )
