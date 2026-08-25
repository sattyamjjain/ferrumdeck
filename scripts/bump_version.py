#!/usr/bin/env python3
"""Bump every version-bearing manifest at once, then verify none was missed.

## Why this exists

The 0.8.13 bump changed two files — `Cargo.toml` and the root `pyproject.toml` —
and missed the other eight. `version-release-consistency` caught it on main and
`08d0bb48` repaired it by hand, which is the same failure waiting to happen
again: the set of files is not memorable, and "I bumped the version" feels done
after the two obvious ones.

So the set lives here, in one place, and the same check the CI workflow runs is
re-run locally afterwards. A bump either moves every manifest or fails.

## The manifests

    Cargo.toml                          [workspace.package] version  (the source of truth)
    pyproject.toml                      [project] version
    python/packages/*/pyproject.toml    [project] version            (six of them)
    src/ferrumdeck/__init__.py          __version__
    nextjs/package.json                 .version
    README.md                           the x-current-version marker + the visible v-string

The README marker is asserted by `readme_current_version_matches_workspace`
(rust/crates/ferrumdeck/tests/), so leaving it behind fails `cargo test` rather
than CI — a different gate, same omission. It is bumped here too.

Usage:
    python scripts/bump_version.py 0.8.14      # bump
    python scripts/bump_version.py --check     # verify only, no writes
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import tomllib
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")


def workspace_version() -> str:
    data = tomllib.loads((REPO / "Cargo.toml").read_text())
    return data["workspace"]["package"]["version"]


def python_manifests() -> list[Path]:
    return [
        REPO / "pyproject.toml",
        *sorted((REPO / "python/packages").glob("*/pyproject.toml")),
    ]


def sub_once(path: Path, pattern: str, replacement: str) -> bool:
    """Replace the FIRST match only, and report whether anything changed.

    First-match-only on purpose: a `version = "x"` line appears in dependency
    tables too, and rewriting those would silently pin a dependency to the
    project's own version.
    """
    text = path.read_text()
    new, n = re.subn(pattern, replacement, text, count=1)
    if n == 0:
        print(f"::error::{path.relative_to(REPO)}: no version line matched", file=sys.stderr)
        raise SystemExit(1)
    if new == text:
        return False
    path.write_text(new)
    return True


def bump(new_version: str) -> None:
    changed: list[str] = []

    if sub_once(
        REPO / "Cargo.toml",
        r'(\[workspace\.package\][\s\S]*?\nversion = ")[^"]+(")',
        rf"\g<1>{new_version}\g<2>",
    ):
        changed.append("Cargo.toml")

    for p in python_manifests():
        if sub_once(p, r'(\[project\][\s\S]*?\nversion = ")[^"]+(")', rf"\g<1>{new_version}\g<2>"):
            changed.append(str(p.relative_to(REPO)))

    if sub_once(
        REPO / "src/ferrumdeck/__init__.py",
        r'(__version__\s*=\s*")[^"]+(")',
        rf"\g<1>{new_version}\g<2>",
    ):
        changed.append("src/ferrumdeck/__init__.py")

    if sub_once(
        REPO / "nextjs/package.json",
        r'("version"\s*:\s*")[^"]+(")',
        rf"\g<1>{new_version}\g<2>",
    ):
        changed.append("nextjs/package.json")

    # The README carries the version twice on one line: a visible `v0.8.13` and
    # an HTML marker the Rust test greps. Both must move together or the test
    # fails on the one left behind.
    readme = REPO / "README.md"
    text = readme.read_text()
    new = re.sub(r"`v\d+\.\d+\.\d+`", f"`v{new_version}`", text, count=1)
    new = re.sub(
        r"(x-current-version:\s*)\d+\.\d+\.\d+", rf"\g<1>{new_version}", new, count=1
    )
    if new != text:
        readme.write_text(new)
        changed.append("README.md")

    for c in changed:
        print(f"  bumped {c}")
    if not changed:
        print(f"  already at {new_version}")


def check() -> int:
    """Re-run the comparison `version-release-consistency` performs."""
    root = workspace_version()
    problems: list[str] = []

    def compare(label: str, found: str | None) -> None:
        if found != root:
            problems.append(f"{label} = {found!r} (expected {root!r})")

    for p in python_manifests():
        data = tomllib.loads(p.read_text())
        compare(str(p.relative_to(REPO)), data.get("project", {}).get("version"))

    init = (REPO / "src/ferrumdeck/__init__.py").read_text()
    m = re.search(r'__version__\s*=\s*["\']([^"\']+)', init)
    compare("src/ferrumdeck/__init__.py", m.group(1) if m else None)

    pkg = json.loads((REPO / "nextjs/package.json").read_text())
    compare("nextjs/package.json", pkg.get("version"))

    readme = (REPO / "README.md").read_text()
    m = re.search(r"x-current-version:\s*(\d+\.\d+\.\d+)", readme)
    compare("README.md x-current-version", m.group(1) if m else None)

    print(f"workspace version: {root}")
    if problems:
        for p in problems:
            print(f"::error::version drift: {p}", file=sys.stderr)
        print(
            "\nRun `python scripts/bump_version.py <version>` rather than editing "
            "these by hand — that is how 0.8.13 shipped with eight stale manifests.",
            file=sys.stderr,
        )
        return 1
    print("  all manifests match")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("version", nargs="?", help="the new version, e.g. 0.8.14")
    ap.add_argument("--check", action="store_true", help="verify only; write nothing")
    args = ap.parse_args()

    if args.check:
        return check()
    if not args.version:
        ap.error("a version is required unless --check is passed")
    if not SEMVER.match(args.version):
        ap.error(f"{args.version!r} is not a bare semver like 0.8.14")

    bump(args.version)
    return check()


if __name__ == "__main__":
    raise SystemExit(main())
