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


def load_floor(path: Path) -> int:
    """Read the executed-test floor from docs/feature-status.yml.

    Deliberately NOT from `.live-stack-known-failures.yml`, where it used to
    live. Every other test count in this repository is owned by
    `docs/feature-status.yml` and held to the README by the claims-integrity
    check; a second, separate home for this one would be a number nobody
    reconciles, which is the drift this repo keeps finding. One file, one
    number, one check that owns it.
    """
    doc = yaml.safe_load(path.read_text()) or {}
    try:
        floor = doc["test_counts"]["liveness"]["executed_floor"]
    except (KeyError, TypeError):
        print(
            f"::error::{path} has no test_counts.liveness.executed_floor. "
            "The live-stack gate reads its floor from there; without it the gate "
            "would silently accept zero executed tests, which is the exact "
            "regression it exists to catch.",
            file=sys.stderr,
        )
        raise SystemExit(1) from None
    return int(floor)


def load_declarations(path: Path) -> dict[str, dict[str, Any]]:
    """Return {test id: entry} for the declared known failures."""
    doc = yaml.safe_load(path.read_text()) or {}
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
    return declared


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
    ap.add_argument(
        "--feature-status",
        type=Path,
        default=Path("docs/feature-status.yml"),
        help="source of truth for the executed-test floor",
    )
    args = ap.parse_args()

    if not args.junit.exists():
        # No report at all is the loudest version of "it never ran".
        print(
            f"::error::No JUnit report at {args.junit}. The suites did not run, which is "
            "exactly the condition this gate exists to catch.",
            file=sys.stderr,
        )
        return 1

    floor = load_floor(args.feature_status)
    declared = load_declarations(args.declarations)
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
        short = floor - executed
        pct = (skipped / collected * 100) if collected else 0.0
        print(
            f"::error title=Live-stack suites skipped instead of ran::"
            f"{executed} tests executed, {short} below the floor of {floor}. "
            f"{skipped} of {collected} collected were SKIPPED ({pct:.0f}%).",
            file=sys.stderr,
        )
        print(
            "\n"
            "  THE SUITES DID NOT RUN. They were collected and skipped, which is not\n"
            "  the same as passing -- pytest reports both as a green dot, which is why\n"
            "  this went unnoticed for months before 0.8.9 (135 collected, 135 skipped,\n"
            "  0 executed, CI green throughout).\n"
            "\n"
            "  This is almost never a code change. In order of likelihood:\n"
            "\n"
            "    1. A service in the compose stack did not come up. The suites' session\n"
            "       fixtures call pytest.skip() when the gateway is unreachable, so the\n"
            "       whole file skips silently.\n"
            "         docker compose -f deploy/docker/compose.dev.yaml ps\n"
            "         curl -fsS http://localhost:8080/health\n"
            "\n"
            "    2. The readiness probe points at a route the gateway does not serve.\n"
            "       This exact bug shipped: the fixtures probed /health/live, which does\n"
            "       not exist (the routes are /health and /ready), so they skipped\n"
            "       unconditionally even against a healthy stack.\n"
            "         grep -rn 'wait_for_service' tests/*/conftest.py\n"
            "\n"
            "    3. The seeded API key or agent id changed. An unseeded key 401s every\n"
            "       request and the fixtures skip rather than fail.\n"
            "         FD_API_KEY (default fd_dev_key_abc123, from\n"
            "         db/migrations/20241223000002_seed_dev_data.sql)\n"
            "\n"
            "    4. The suites are addressing the wrong service. The gateway serves\n"
            "       /v1/...; /api/v1/... is the Next.js BFF on :3001. 144 assertions\n"
            "       were pointed at the wrong one and 404'd, and many still 'passed'\n"
            "       because `assert status in (403, 404)` holds for a 404.\n"
            "\n"
            f"  The floor lives in docs/feature-status.yml (test_counts.liveness.executed_floor\n"
            f"  = {floor}), owned by the claims-integrity check like every other count.\n"
            "  If a test now skips for a GOOD reason, lower it there in the same commit\n"
            "  that explains why. Do not lower it to turn this build green.\n",
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
