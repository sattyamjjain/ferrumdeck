#!/usr/bin/env python3
"""Gate the live-stack suites on tests that actually EXECUTED, not tests collected.

The "exists but never executed" class, fifth instance and the one issue #6 named.
`tests/security`, `tests/chaos` and `tests/e2e` reported *135 collected, 135
skipped, 0 run*: chaos and e2e were in no workflow at all, and security ran only
inside a `|| true` step with no stack behind it. Every one of those suites was
green, and none of them had asserted anything.

Collected is not run, and passed is not asserted. `scripts/gen_eval_health.py`
made the same distinction for evals; this makes it for the live-stack suites.

## What this fails on

1. **Executed below the floor.** `executed = collected - skipped`. This is a
   CLIFF DETECTOR, deliberately set well below the observed count rather than at
   it. The failure it exists to catch collapses the number to roughly zero -- the
   stack not booting, the readiness probe pointing at a route the gateway does
   not serve (`/health/live`, which happened), the seeded API key being wrong
   (which also happened). A high-water ratchet on a number that legitimately
   moves produces false failures, and a gate that cries wolf gets deleted.

2. **An undeclared failure.** Anything red that is not in
   `.live-stack-known-failures.yml` fails the build. That is the difference
   between this and `|| true`.

3. **A stale declaration.** A declared failure that now passes fails the build,
   so the exemption list cannot quietly become permanent. Entries marked
   `flaky: true` are exempt from this check only -- they still may not fail
   undeclared.

Exit 0 when all three hold, 1 otherwise.
"""

from __future__ import annotations

import argparse
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import yaml


def load_declarations(path: Path) -> tuple[int, dict[str, dict[str, Any]]]:
    """Return (executed floor, {test id: entry})."""
    doc = yaml.safe_load(path.read_text()) or {}
    floor = int((doc.get("floor") or {}).get("executed", 0))
    declared: dict[str, dict[str, Any]] = {}
    for entry in doc.get("known_failures") or []:
        test = entry.get("test")
        if not test:
            print(f"::error::{path}: a known_failures entry has no `test:` key", file=sys.stderr)
            raise SystemExit(1)
        if not entry.get("reason"):
            # A bare exemption is indistinguishable from someone silencing a
            # test they did not understand.
            print(f"::error::{path}: {test} is declared with no `reason:`", file=sys.stderr)
            raise SystemExit(1)
        declared[test] = entry
    return floor, declared


def case_id(case: ET.Element) -> str:
    """Normalize a JUnit <testcase> to the `path/to/test.py::Class::name` form.

    pytest emits `classname="tests.e2e.test_agent_runs.TestRunTimeout"` and only
    sometimes a `file` attribute, so the dotted form has to be converted back to
    a path. Module segments are lowercase by convention and the class segment is
    capitalized, which is what splits them here. Declarations are written in the
    node-id form a developer can paste straight into `pytest`, and that only
    works if this reconstruction is exact.
    """
    name = case.get("name", "")
    file_attr = case.get("file")
    classname = case.get("classname", "")

    if not classname:
        return f"{file_attr}::{name}" if file_attr else name

    parts = classname.split(".")
    # Everything up to the first capitalized segment is the module path.
    idx = next((i for i, seg in enumerate(parts) if seg[:1].isupper()), len(parts))
    module_parts, class_parts = parts[:idx], parts[idx:]

    path = file_attr or ("/".join(module_parts) + ".py")
    return "::".join([path, *class_parts, name])


def parse_junit(path: Path) -> tuple[int, int, set[str], set[str]]:
    """Return (collected, skipped, failed ids, passed ids) from a JUnit XML report."""
    root = ET.parse(path).getroot()
    suites = [root] if root.tag == "testsuite" else list(root.iter("testsuite"))

    collected = skipped = 0
    failed: set[str] = set()
    passed: set[str] = set()

    for suite in suites:
        collected += int(suite.get("tests", 0))
        skipped += int(suite.get("skipped", 0))
        for case in suite.iter("testcase"):
            test_id = case_id(case)
            if case.find("skipped") is not None:
                continue
            if case.find("failure") is not None or case.find("error") is not None:
                failed.add(test_id)
            else:
                passed.add(test_id)

    return collected, skipped, failed, passed


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--junit", type=Path, required=True, help="pytest --junitxml report")
    ap.add_argument("--declarations", type=Path, default=Path(".live-stack-known-failures.yml"))
    args = ap.parse_args()

    if not args.junit.exists():
        # No report at all is the loudest version of "it never ran".
        print(
            f"::error::No JUnit report at {args.junit}. The suites did not run, which is "
            "exactly the condition this gate exists to catch.",
            file=sys.stderr,
        )
        return 1

    floor, declared = load_declarations(args.declarations)
    collected, skipped, failed, passed = parse_junit(args.junit)
    executed = collected - skipped

    print(
        f"collected={collected} skipped={skipped} executed={executed} "
        f"failed={len(failed)} passed={len(passed)} (floor {floor})"
    )

    sys.stdout.flush()
    rc = 0

    # --- 1. the cliff detector --------------------------------------------
    if executed < floor:
        print(
            f"::error::Only {executed} tests executed against the live stack, below the "
            f"floor of {floor}. This is the shape of a stack that did not come up, a "
            f"readiness probe pointing at a route the gateway does not serve, or an "
            f"unseeded API key -- not of a code change. {collected} collected, {skipped} skipped.",
            file=sys.stderr,
        )
        rc = 1

    # --- 2. undeclared failures -------------------------------------------
    undeclared = sorted(failed - set(declared))
    for test in undeclared:
        print(f"::error::Undeclared failure: {test}", file=sys.stderr)
    if undeclared:
        print(
            f"\n{len(undeclared)} test(s) failed that are not declared in {args.declarations}. "
            "Fix them, or add an entry with a real reason -- an exemption without a "
            "diagnosis is a silenced test.",
            file=sys.stderr,
        )
        rc = 1

    # --- 3. stale declarations --------------------------------------------
    stale = sorted(t for t in (set(declared) & passed) if not declared[t].get("flaky", False))
    for test in stale:
        print(f"::error::Stale declaration (now passes): {test}", file=sys.stderr)
    if stale:
        print(
            f"\n{len(stale)} declared failure(s) now pass. Remove them from "
            f"{args.declarations} so the list keeps shrinking.",
            file=sys.stderr,
        )
        rc = 1

    if rc == 0:
        flaky = sum(1 for e in declared.values() if e.get("flaky"))
        print(
            f"OK — {executed} executed (floor {floor}), "
            f"{len(failed)} failure(s), all declared ({len(declared)} entries, {flaky} flaky)."
        )
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
