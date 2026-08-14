#!/usr/bin/env python3
"""Generate docs/eval-health.md from the real report files in evals/reports/.

The product claims eval gating in CI. This page is what backs that claim or
shows exactly where it does not. It is generated from committed report JSON
only -- nothing here is asserted by hand.

An eval with no passing report in its history is reported as NEVER PASSED, in
its own row, rather than being omitted or rendered as a neutral blank. The
safe-PR smoke suite spent forty consecutive nightly runs at 0% while the README
claimed eval gating; the point of this page is that such a gap is visible.

Usage:
    python scripts/gen_eval_health.py [--reports evals/reports] [--out docs/eval-health.md]
    python scripts/gen_eval_health.py --check    # exit 1 if the file is stale
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

# Evals we expect to exist. Listing them explicitly means an eval that has
# never once produced a report still gets a row saying so, instead of silently
# not appearing because there is no data.
EXPECTED_EVALS: dict[str, str] = {
    "smoke": "LLM-backed safe-PR smoke suite (nightly)",
    "regression": "LLM-backed safe-PR full regression",
    "asb": "Agent Security Bench + EU AI Act Art.50 (offline, seeded)",
    "injection_defense": "Prompt-injection defense benchmark (offline)",
    "governed-benchmark": "Governed vs ungoverned overhead (offline)",
}

DATE_RE = re.compile(r"(20\d{6})")
TS_RE = re.compile(r"(20\d{6})_(\d{6})")


@dataclass
class RunRecord:
    """One eval run, normalized across the report families."""

    eval_name: str
    when: datetime
    passed: bool
    score: float | None
    detail: str
    source: str


@dataclass
class EvalHealth:
    name: str
    description: str
    runs: list[RunRecord] = field(default_factory=list)

    @property
    def latest(self) -> RunRecord | None:
        return self.runs[-1] if self.runs else None

    @property
    def ever_passed(self) -> bool:
        return any(r.passed for r in self.runs)

    @property
    def consecutive_passes(self) -> int:
        """Passes at the tail of the history, most recent first."""
        count = 0
        for run in reversed(self.runs):
            if not run.passed:
                break
            count += 1
        return count


def _parse_when(path: Path) -> datetime:
    stamp = TS_RE.search(path.stem)
    if stamp:
        return datetime.strptime(f"{stamp.group(1)}{stamp.group(2)}", "%Y%m%d%H%M%S").replace(
            tzinfo=UTC
        )
    day = DATE_RE.search(path.stem)
    if day:
        return datetime.strptime(day.group(1), "%Y%m%d").replace(tzinfo=UTC)
    return datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)


def _rate(blob: Any) -> float | None:
    if isinstance(blob, dict) and "rate" in blob:
        try:
            return float(blob["rate"])
        except (TypeError, ValueError):
            return None
    return None


def _classify(path: Path, data: dict[str, Any]) -> RunRecord | None:
    """Normalize one report file into a RunRecord, or None if unrecognized."""
    when = _parse_when(path)
    stem = path.stem

    # Offline defense benchmarks: asb, injection_defense.
    if "block_rate_under_attack" in data:
        name = str(data.get("suite") or stem.split("-")[0])
        block = _rate(data.get("block_rate_under_attack"))
        utility = _rate(data.get("benign_utility"))
        parity = bool(data.get("corpus_parity_ok", False))
        mismatches = data.get("mismatches") or []
        passed = bool(parity and not mismatches and block is not None and block >= 1.0)
        detail = (f"block {block:.0%}" if block is not None else "block n/a") + (
            f", benign utility {utility:.0%}" if utility is not None else ""
        )
        if mismatches:
            detail += f", {len(mismatches)} mismatch(es)"
        if not parity:
            detail += ", corpus parity FAILED"
        return RunRecord(name, when, passed, block, detail, path.name)

    # Governed vs ungoverned overhead benchmark.
    if "governed_block_pct" in data:
        pct = float(data.get("governed_block_pct") or 0.0)
        ungoverned = float(data.get("ungoverned_block_pct") or 0.0)
        passed = pct >= 100.0
        return RunRecord(
            "governed-benchmark",
            when,
            passed,
            pct / 100.0,
            f"governed blocked {pct:.0f}% vs ungoverned {ungoverned:.0f}%",
            path.name,
        )

    # EvalRunSummary (the LLM-backed suites written by `fd_evals run`).
    if "average_score" in data and "total_tasks" in data:
        total = int(data.get("total_tasks") or 0)
        passed_tasks = int(data.get("passed_tasks") or 0)
        failed = int(data.get("failed_tasks") or 0)
        score = float(data.get("average_score") or 0.0)
        name = stem
        if stem.startswith("eval_"):
            name = stem[len("eval_") :]
            name = TS_RE.sub("", name).strip("_-") or "smoke"
        passed = total > 0 and failed == 0
        return RunRecord(
            name,
            when,
            passed,
            score,
            f"{passed_tasks}/{total} tasks passed, avg score {score:.2f}",
            path.name,
        )

    return None


def collect(reports_dir: Path) -> dict[str, EvalHealth]:
    health = {
        name: EvalHealth(name=name, description=desc) for name, desc in EXPECTED_EVALS.items()
    }

    for path in sorted(reports_dir.glob("*.json")):
        try:
            data = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        if not isinstance(data, dict):
            continue
        record = _classify(path, data)
        if record is None:
            continue
        bucket = health.setdefault(
            record.eval_name, EvalHealth(name=record.eval_name, description="(discovered)")
        )
        bucket.runs.append(record)

    for bucket in health.values():
        bucket.runs.sort(key=lambda r: r.when)
    return health


def render(health: dict[str, EvalHealth], generated_at: datetime) -> str:
    lines: list[str] = []
    add = lines.append

    add("# Eval health")
    add("")
    add(
        "Generated from the report files in `evals/reports/` by "
        "`scripts/gen_eval_health.py`. Regenerated on every nightly "
        "`Evaluations` run; do not edit by hand."
    )
    add("")
    add(
        "FerrumDeck claims eval gating in CI. This page is the evidence for "
        "that claim. An eval that has never passed says so in its own row "
        "rather than being left out."
    )
    add("")
    add("| Eval | Last run | Result | Score | Consecutive passes | Detail |")
    add("| --- | --- | --- | --- | --- | --- |")

    for name in sorted(health):
        bucket = health[name]
        latest = bucket.latest

        if latest is None:
            add(
                f"| `{name}` | — | **NEVER RUN** | — | 0 | "
                f"No report has ever been committed for this eval |"
            )
            continue

        when = latest.when.strftime("%Y-%m-%d")
        score = f"{latest.score:.2f}" if latest.score is not None else "—"

        if not bucket.ever_passed:
            result = "**NEVER PASSED**"
            streak = "0"
            detail = f"{latest.detail} — no passing run in {len(bucket.runs)} recorded run(s)"
        else:
            result = "pass" if latest.passed else "**FAIL**"
            streak = str(bucket.consecutive_passes)
            detail = latest.detail

        add(f"| `{name}` | {when} | {result} | {score} | {streak} | {detail} |")

    add("")
    never = sorted(n for n, b in health.items() if not b.ever_passed)
    if never:
        add("## Evals with no passing run")
        add("")
        for name in never:
            bucket = health[name]
            runs = len(bucket.runs)
            add(
                f"- **`{name}`** — {bucket.description}. "
                + (
                    f"{runs} recorded run(s), none passing."
                    if runs
                    else "No report has ever been committed."
                )
            )
        add("")
        add(
            "These are gaps in the eval-gating claim, not passing rows waiting "
            "to be filled in. Treat this section shrinking as the measure of progress."
        )
        add("")

    add("## How a row is decided")
    add("")
    add(
        "| Report family | Counts as a pass when |\n"
        "| --- | --- |\n"
        "| `asb`, `injection_defense` | corpus parity holds, zero mismatches, "
        "and attack block rate is 100% |\n"
        "| `governed-benchmark` | the governed run blocks 100% of unsafe actions |\n"
        "| `eval_<suite>_<ts>` (LLM suites) | every task passed (`failed_tasks == 0`) |"
    )
    add("")
    add(f"_Generated {generated_at.strftime('%Y-%m-%d %H:%M UTC')}._")
    add("")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reports", type=Path, default=Path("evals/reports"))
    ap.add_argument("--out", type=Path, default=Path("docs/eval-health.md"))
    ap.add_argument(
        "--check",
        action="store_true",
        help="Exit 1 if the generated page differs from the committed one.",
    )
    args = ap.parse_args()

    if not args.reports.is_dir():
        print(f"No reports directory at {args.reports}", file=sys.stderr)
        return 1

    health = collect(args.reports)
    # A fixed timestamp line would churn the file on every run; --check
    # compares everything above it.
    rendered = render(health, datetime.now(tz=UTC))

    if args.check:
        if not args.out.exists():
            print(f"{args.out} does not exist; run without --check to create it.")
            return 1
        current = args.out.read_text().rsplit("_Generated", 1)[0]
        fresh = rendered.rsplit("_Generated", 1)[0]
        if current != fresh:
            print(f"{args.out} is stale; regenerate with scripts/gen_eval_health.py")
            return 1
        print(f"{args.out} is up to date.")
        return 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(rendered)
    never = sorted(n for n, b in health.items() if not b.ever_passed)
    print(f"Wrote {args.out} ({len(health)} evals, {len(never)} with no passing run)")
    if never:
        print("  never passed: " + ", ".join(never))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
