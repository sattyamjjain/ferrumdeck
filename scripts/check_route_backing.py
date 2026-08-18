#!/usr/bin/env python3
"""Fail if an HTTP route serves plausible data without reaching a backend.

The last place the "exists but never executed" sweep had not looked.

Three gates closed that class in the 0.8.8 cycle -- a declared eval with no
committed report, a collection root CI silently stopped matching, a suite no
workflow could reach -- and all three live in the python-test job. Issue #7
named the remaining surface directly: `/api/v1/evals/*` was BFF-stubbed, so the
dashboard rendered a shape that had never touched the control plane. A route
returning `200 {"suites": []}` is the same defect as an eval that never runs.
It looks green and asserts nothing.

## The invariant

Both planes already follow it; this writes it down so it cannot erode:

    An unimplemented route returns 501 with `error: "not_implemented"` and an
    `issue:` link. It never returns 200 with an empty list or a fixture.

`200 {"total_regressions": 0}` cannot be distinguished by a reader from "we
looked and found none". 501 says "we never looked", which is the true
statement, and it carries the issue where that is being fixed.

## What fails the build

1. A route reaches no backend and is not declared in `.route-backing.yml`.
   Either it is a new stub (declare it) or it fabricates (fix it).
2. A declared stub does not actually return 501 -- it has become a fixture.
3. A stub returns 501 but cites no issue, so nothing tracks finishing it.
4. A declaration has gone stale: the route was implemented or deleted, and the
   entry now grants an exemption nothing needs.

(4) is what stops this file rotting into a permanent allowlist, the failure
mode of every suppression list that only ever grows.

Usage:
    python scripts/check_route_backing.py
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any

import yaml

# A call that leaves this process for a real backend.
BACKEND_CALL_RE = re.compile(r"\b(fetch|gatewayFetch|proxyTo|spawn|spawnSync|execFile)\s*\(")

# The honest-stub marker, and the issue reference that must accompany it.
NOT_IMPLEMENTED_RE = re.compile(r'["\']?error["\']?\s*:\s*["\']not_implemented["\']')
STATUS_501_RE = re.compile(r"status\s*:\s*501|StatusCode::NOT_IMPLEMENTED")
ISSUE_REF_RE = re.compile(r"issues/(\d+)|issue[\"']?\s*:\s*[\"']?(\d+)")

# A module-level import of a real data loader also counts as backing: the route
# has a source even though the call is not literally `fetch(` in this file.
LOADER_IMPORT_RE = re.compile(r"^\s*import\s+\{[^}]*\b(load[A-Z]\w*|read[A-Z]\w*)\b", re.M)


def classify(text: str) -> set[str]:
    """Traits of one route file, from its source."""
    traits: set[str] = set()
    if BACKEND_CALL_RE.search(text):
        traits.add("backend_call")
    if LOADER_IMPORT_RE.search(text):
        traits.add("loader")
    if NOT_IMPLEMENTED_RE.search(text):
        traits.add("not_implemented")
    if STATUS_501_RE.search(text):
        traits.add("status_501")
    if ISSUE_REF_RE.search(text):
        traits.add("issue_ref")
    return traits


def bff_routes(app_api: Path) -> dict[str, Path]:
    """Map BFF route id (path under app/api) -> file."""
    return {str(p.relative_to(app_api)): p for p in sorted(app_api.rglob("route.ts"))}


def load_declarations(path: Path) -> tuple[dict[str, dict], dict[str, dict]]:
    if not path.exists():
        return {}, {}
    data: dict[str, Any] = yaml.safe_load(path.read_text()) or {}
    local = {e["route"]: e for e in (data.get("local_backed") or [])}
    stubs = {e["route"]: e for e in (data.get("declared_stubs") or [])}
    return local, stubs


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--app-api", type=Path, default=Path("nextjs/src/app/api"))
    ap.add_argument("--declarations", type=Path, default=Path(".route-backing.yml"))
    ap.add_argument(
        "--gateway",
        type=Path,
        default=Path("rust/services/gateway/src/handlers"),
    )
    args = ap.parse_args()

    if not args.app_api.is_dir():
        print(f"No BFF route directory at {args.app_api}", file=sys.stderr)
        return 1

    local, stubs = load_declarations(args.declarations)
    routes = bff_routes(args.app_api)
    if not routes:
        print(f"No routes found under {args.app_api}", file=sys.stderr)
        return 1

    problems: list[str] = []
    counts = {"proxied": 0, "local": 0, "stub": 0}
    seen_local: set[str] = set()
    seen_stub: set[str] = set()

    width = max(len(r) for r in routes)
    for rid, path in routes.items():
        traits = classify(path.read_text())
        declared_stub = rid in stubs
        declared_local = rid in local

        if declared_stub:
            seen_stub.add(rid)
            # (2) a declared stub must still BE a stub, not a fixture.
            if not (traits & {"not_implemented", "status_501"}):
                problems.append(
                    f"{rid} is declared a stub in {args.declarations} but no longer "
                    f"returns 501/not_implemented. If it was implemented, delete the "
                    f"entry; if it now returns fixture data, that is the bug this "
                    f"check exists for."
                )
            # (3) a stub must name the issue that tracks finishing it.
            elif "issue_ref" not in traits:
                problems.append(
                    f"{rid} returns 501 but cites no issue. An untracked stub is a "
                    f"permanent one; add the issue link to the response body."
                )
            counts["stub"] += 1
            status = "STUB"
        elif declared_local:
            seen_local.add(rid)
            counts["local"] += 1
            status = "LOCAL"
        elif traits & {"backend_call", "loader"}:
            counts["proxied"] += 1
            status = "PROXY"
        elif traits & {"not_implemented", "status_501"}:
            # An honest stub nobody declared. Still a stub -- declare it, so the
            # set of unimplemented routes stays visible and countable.
            problems.append(
                f"{rid} returns 501/not_implemented but is not declared in "
                f"{args.declarations}. Add it under declared_stubs with the issue "
                f"tracking it, so the stub surface is countable rather than folklore."
            )
            status = "UNDECLARED-STUB"
        else:
            # (1) the dangerous class: no backend, no stub marker. Whatever it
            # returns, it made it up.
            problems.append(
                f"{rid} reaches no backend and is not a declared stub. It returns "
                f"something without asking anything -- either wire it to the gateway, "
                f"make it an honest 501 with an issue, or declare it under "
                f"local_backed with what it actually reads."
            )
            status = ">>> UNBACKED"

        print(f"  {status:16} {rid:<{width}}")

    # (4) stale declarations.
    for rid in sorted(set(stubs) - seen_stub):
        problems.append(
            f"{args.declarations} declares stub {rid!r}, which no longer exists. Remove the entry."
        )
    for rid in sorted(set(local) - seen_local):
        problems.append(
            f"{args.declarations} declares local-backed route {rid!r}, which no "
            f"longer exists. Remove the entry."
        )

    print(
        f"\n{len(routes)} routes: {counts['proxied']} proxied, "
        f"{counts['local']} locally backed, {counts['stub']} declared stubs."
    )

    if problems:
        sys.stdout.flush()
        print(file=sys.stderr)
        for p in problems:
            print(f"ROUTE-BACKING: {p}", file=sys.stderr)
        print(
            "\nA route that returns plausible data without reaching a backend is the "
            "same class of bug as an eval that never runs: it looks green and asserts "
            "nothing. Declare it, wire it, or make it an honest 501.",
            file=sys.stderr,
        )
        return 1

    print("OK — every route reaches a backend, or is a declared and honest stub.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
