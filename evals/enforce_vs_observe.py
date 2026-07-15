#!/usr/bin/env python3
"""Standalone repro for the observability blind-spot benchmark.

Runs ONE public injection trace (AgentDojo-style) two ways over the same
governance profile and prints the side-by-side result:

  (a) observability-only  — records the tool call *after* it runs (no gate)
  (b) ferrumdeck in-path gate — decides *before* execution, emits
      ferrumdeck.decision=deny on the same GenAI span, call never runs

This is the exact command referenced by docs/benchmarks/enforce-vs-observe.md.
It is deterministic, offline, and uses no LLM — the contrast is architectural
(record-after vs decide-before), not model quality. Exits non-zero if the
blind-spot contrast does not hold.

    uv run python evals/enforce_vs_observe.py
    # or, equivalently, via the CLI:
    uv run python -m fd_evals enforce-vs-observe

Nothing is executed here: the corpus is inert tool-call data. "record-only lets
the call run" is the honest model of a stack with no decision point.
"""

from __future__ import annotations

import sys
from pathlib import Path

from fd_evals.enforce_vs_observe import assert_contrast, render_report, run_comparison

# Repo-root-relative corpus (same AgentDojo-style corpus as the injection-
# defense axis). Resolve from this file so the repro works from any cwd.
CORPUS_DIR = Path(__file__).resolve().parent / "datasets" / "injection_defense"
CASE_ID = "atk_unauth_01"


def main() -> int:
    if not (CORPUS_DIR / "tasks.jsonl").exists():
        print(f"corpus not found under {CORPUS_DIR}", file=sys.stderr)
        return 2

    cmp = run_comparison(CORPUS_DIR, CASE_ID)
    print(render_report(cmp))

    try:
        assert_contrast(cmp)
    except AssertionError as exc:
        print(f"\nBLIND-SPOT CONTRAST FAILED: {exc}", file=sys.stderr)
        return 1
    print(
        "\nOK — record-only observed the breach; the in-path gate blocked it "
        "pre-execution on the same span."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
