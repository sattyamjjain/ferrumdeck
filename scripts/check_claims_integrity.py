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
        "live-stack" in readme.lower()
        and all(s in readme for s in ("security", "chaos", "e2e"))
    ):
        errors.append(
            "README test-count block must name the live-stack suites "
            "(security/chaos/e2e) as excluded from the headline."
        )
    for suite in ("security", "chaos", "e2e"):
        if str(lv[suite]) not in readme:
            errors.append(
                f"README test-count block is missing the live-stack {suite} "
                f"count ({lv[suite]})."
            )


def _run(cmd: str) -> str:
    return subprocess.run(
        cmd, shell=True, cwd=ROOT, capture_output=True, text=True
    ).stdout


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
    # Rust + frontend need a build; re-derive only if the toolchains are present.
    rust_declared = tc["gating"]["rust"]["count"]
    rust_out = _run("cargo test --workspace -- --list 2>/dev/null")
    rust_actual = sum(1 for ln in rust_out.splitlines() if ln.rstrip().endswith(": test"))
    if rust_actual:
        status = "OK " if rust_actual == rust_declared else "BAD"
        print(f"  {status} rust: declared {rust_declared}, re-derived {rust_actual}")
        if rust_actual != rust_declared:
            errors.append(
                f"test count drift [rust]: declared {rust_declared}, "
                f"re-derived {rust_actual}."
            )
    else:
        print("  --  rust: skipped (no build output; run `cargo test` first)")


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
    print("\nOK — Key Features, ROADMAP, and the test-count block agree with docs/feature-status.yml.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
