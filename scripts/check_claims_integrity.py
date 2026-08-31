#!/usr/bin/env python3
"""Claims-integrity gate: keep README, ROADMAP, and reality in agreement.

`docs/feature-status.yml` is the single source of truth. This script fails when:

  1. a Key Features row named in the source is missing its status marker
     (so a feature the Limitations section contradicts cannot silently read as a
     shipped guarantee);
  2. ROADMAP.md no longer references a contradicted feature's tracking issue
     (the two files must not drift);
  3. the README test-count block disagrees with `test_counts` (headline total +
     the liveness caveat);
  4. with `--recount`: the re-derived test counts disagree with the source.

Default (no flags) does only cheap text checks — no build, no network — so it is
safe to run on every PR. `--recount` shells out to pytest/cargo/jest to
re-derive the numbers; run it (via `make claims-recount`) after tests change.

Usage:
    python scripts/check_claims_integrity.py            # text checks (CI)
    python scripts/check_claims_integrity.py --recount  # + re-derive counts
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "feature-status.yml"
README = ROOT / "README.md"
ROADMAP = ROOT / "ROADMAP.md"


def load_source() -> dict:
    return yaml.safe_load(SOURCE.read_text())


def _key_features_bullets(readme: str) -> list[str]:
    return [ln for ln in readme.splitlines() if ln.lstrip().startswith("-")]


def check_markers(src: dict, readme: str, roadmap: str, errors: list[str]) -> None:
    bullets = _key_features_bullets(readme)
    for feat in src["key_features"]:
        fid = feat["id"]
        row = feat["readme_row"]
        marker = feat["marker"]
        matched = [b for b in bullets if row in b]
        if not matched:
            errors.append(
                f"[{fid}] Key Features row not found (looked for {row!r}). "
                "If the row was renamed, update docs/feature-status.yml."
            )
            continue
        if not any(marker in b for b in matched):
            errors.append(
                f"[{fid}] Key Features row {row!r} is missing its status marker "
                f"{marker!r}. This feature is contradicted by the Limitations "
                "section and must carry an inline status marker."
            )
        issue = feat.get("roadmap_issue")
        if issue and f"#{issue}" not in roadmap and f"issues/{issue}" not in roadmap:
            errors.append(
                f"[{fid}] ROADMAP.md no longer references issue #{issue} — README "
                "and ROADMAP have drifted; re-link the tracking issue."
            )


def check_test_block(src: dict, readme: str, errors: list[str]) -> None:
    tc = src["test_counts"]
    total = tc["gating_total"]
    formatted = f"{total:,}"
    if formatted not in readme and str(total) not in readme:
        errors.append(
            f"README is missing the gating test-count total {formatted}. "
            "The test-count block must render test_counts.gating_total."
        )
    lv = tc["liveness"]
    # The liveness caveat must be adjacent to the number, naming the excluded suites.
    if not (
        "live-stack" in readme.lower() and all(s in readme for s in ("security", "chaos", "e2e"))
    ):
        errors.append(
            "README test-count block must name the live-stack suites "
            "(security/chaos/e2e) as excluded from the headline."
        )
    for suite in ("security", "chaos", "e2e"):
        if str(lv[suite]) not in readme:
            errors.append(
                f"README test-count block is missing the live-stack {suite} count ({lv[suite]})."
            )

    # The executed-test floor: the number that says how many of those collected
    # tests actually RUN. It is the one count here that guards a silent
    # regression (135 collected / 135 skipped / 0 executed, CI green), so the
    # README has to state it and this check owns it like every other count.
    #
    # Matched as a phrase, not a bare substring: the README contains "8080" (the
    # gateway port), so `str(80) in readme` would pass vacuously.
    floor = lv.get("executed_floor")
    if floor is None:
        errors.append(
            "docs/feature-status.yml is missing test_counts.liveness.executed_floor. "
            "scripts/check_live_stack_results.py reads the live-stack gate's floor "
            "from there; without it the gate accepts zero executed tests."
        )
    elif f"executed-test floor of {floor}" not in readme:
        errors.append(
            f"README test-count block must render the executed-test floor as "
            f"'executed-test floor of {floor}'. Collected is not run, and the "
            "README should say which number is which."
        )


def _run(cmd: str) -> str:
    return subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True, text=True).stdout


def _collect_count(paths: str) -> int:
    out = _run(f"uv run pytest {paths} --collect-only -q 2>/dev/null")
    m = re.search(r"(\d+)\s+tests?\s+collected", out)
    return int(m.group(1)) if m else -1


def recount(src: dict, errors: list[str]) -> None:
    tc = src["test_counts"]
    checks = {
        "python_unit": (
            tc["gating"]["python_unit"]["count"],
            "python/packages/fd-runtime/tests python/packages/fd-mcp-router/tests "
            "python/packages/fd-worker/tests python/packages/fd-evals/tests",
        ),
        "api_contracts": (tc["gating"]["api_contracts"]["count"], "tests/api"),
        "liveness.security": (tc["liveness"]["security"], "tests/security"),
        "liveness.chaos": (tc["liveness"]["chaos"], "tests/chaos"),
        "liveness.e2e": (tc["liveness"]["e2e"], "tests/e2e"),
        "liveness.integration": (tc["liveness"]["integration"], "tests/integration"),
    }
    for name, (declared, paths) in checks.items():
        actual = _collect_count(paths)
        status = "OK " if actual == declared else "BAD"
        print(f"  {status} {name}: declared {declared}, re-derived {actual}")
        if actual != declared:
            errors.append(
                f"test count drift [{name}]: declared {declared}, "
                f"re-derived {actual}. Update docs/feature-status.yml + the README."
            )
    # Rust and frontend need their toolchains; each re-derives only if present,
    # and a skip is printed rather than passed over.
    rust_declared = tc["gating"]["rust"]["count"]
    rust_out = _run("cargo test --workspace -- --list 2>/dev/null")
    rust_actual = sum(1 for ln in rust_out.splitlines() if ln.rstrip().endswith(": test"))
    if rust_actual:
        status = "OK " if rust_actual == rust_declared else "BAD"
        print(f"  {status} rust: declared {rust_declared}, re-derived {rust_actual}")
        if rust_actual != rust_declared:
            errors.append(
                f"test count drift [rust]: declared {rust_declared}, re-derived {rust_actual}."
            )
    else:
        print("  --  rust: skipped (no build output; run `cargo test` first)")

    # Frontend. This block did not exist until 0.8.16: the comment above claimed
    # "rust + frontend" were both re-derived and only rust ever was, so
    # `frontend: 623` was a declared number nothing had ever checked. It had
    # drifted to 681. Jest prints its summary on STDERR, which is why `_run`
    # (stdout only) needs the explicit redirect — capture it wrong and this
    # degrades to a permanent silent skip, which is the failure it replaces.
    fe_declared = tc["gating"]["frontend"]["count"]
    fe_out = _run("cd nextjs && npm test -- --watchAll=false --ci 2>&1")
    fe_match = re.search(r"^Tests:.*?(\d+)\s+total", fe_out, re.MULTILINE)
    if fe_match:
        fe_actual = int(fe_match.group(1))
        status = "OK " if fe_actual == fe_declared else "BAD"
        print(f"  {status} frontend: declared {fe_declared}, re-derived {fe_actual}")
        if fe_actual != fe_declared:
            errors.append(
                f"test count drift [frontend]: declared {fe_declared}, re-derived {fe_actual}."
            )
    else:
        print("  --  frontend: skipped (no jest summary; run `npm install --prefix nextjs`)")

    # Executed-test floor. Re-derived from a live-stack JUnit report rather than
    # by booting a stack: `claims-recount` must stay a local, cheap command.
    # `make test-live-stack` (or the CI job) writes the report; without one this
    # skips with a note, the same way rust/frontend skip when their toolchain
    # output is absent. A skip is reported, never silently treated as agreement.
    floor = tc["liveness"].get("executed_floor")
    report = ROOT / "live-stack-results.xml"
    if floor is None:
        errors.append("docs/feature-status.yml is missing test_counts.liveness.executed_floor.")
    elif not report.exists():
        print(
            f"  --  live_stack_executed_floor: skipped (declared {floor}; no "
            "live-stack-results.xml — run `make test-live-stack` against a stack)"
        )
    else:
        root = ET.parse(report).getroot()
        suites = [root] if root.tag == "testsuite" else list(root.iter("testsuite"))
        collected = sum(int(x.get("tests", 0)) for x in suites)
        skipped = sum(int(x.get("skipped", 0)) for x in suites)
        executed = collected - skipped
        status = "OK " if executed >= floor else "BAD"
        print(
            f"  {status} live_stack_executed_floor: floor {floor}, "
            f"last run executed {executed} ({collected} collected, {skipped} skipped)"
        )
        if executed < floor:
            errors.append(
                f"live-stack executed count {executed} is below the declared floor "
                f"{floor}. Either the stack is not healthy, or the floor needs a "
                "conscious re-baseline in docs/feature-status.yml."
            )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--recount",
        action="store_true",
        help="also re-derive test counts (shells out to pytest/cargo)",
    )
    args = ap.parse_args()

    src = load_source()
    readme = README.read_text()
    roadmap = ROADMAP.read_text()
    errors: list[str] = []

    print("Checking Key Features status markers + README/ROADMAP agreement...")
    check_markers(src, readme, roadmap, errors)
    print("Checking README test-count block...")
    check_test_block(src, readme, errors)
    if args.recount:
        print("Re-deriving test counts...")
        recount(src, errors)

    if errors:
        print("\nCLAIMS-INTEGRITY CHECK FAILED:", file=sys.stderr)
        for e in errors:
            print(f"  ::error:: {e}", file=sys.stderr)
        return 1
    print(
        "\nOK — Key Features, ROADMAP, and the test-count block agree with docs/feature-status.yml."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
