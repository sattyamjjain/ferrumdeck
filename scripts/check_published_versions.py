#!/usr/bin/env python3
"""Assert every publishable crate is on crates.io at the workspace version.

## Why this exists

The publish walk in `.github/workflows/release-crate.yml` is a hand-maintained
list of `cargo publish -p ...` steps. A crate missing from that list is not
published, and **nothing fails** — the release goes green, the tag lands, and
the crate silently rots on crates.io at whatever version it last reached.

This has now happened twice:

* `ferrumdeck-otel` was omitted until 0.8.17 and drifted five patch releases
  behind (0.8.12 while the workspace was 0.8.17).
* `ferrumdeck-dag` was still omitted after that fix and drifted six behind
  (0.8.12 while the workspace was 0.8.18).

The second one is the point. Fixing the first by appending one line to the walk
left the *failure mode* — silence — completely intact, so the next crate was
stranded the same way. A walk that cannot fail loudly will strand the crate
after that one too.

## What "publishable" means

Not a list here, deliberately: a second hand-maintained list would drift from
the first. A crate is publishable unless its `Cargo.toml` says
`publish = false`. That makes the manifest the single declaration, so adding a
new crate opts it into this check automatically — the author has to make a
conscious choice either way.

## Usage

    python scripts/check_published_versions.py            # check crates.io
    python scripts/check_published_versions.py --offline  # manifest wiring only

`--offline` skips the network and checks only what is knowable locally (that
every publishable crate is actually a step in the publish walk). CI runs the
full check after the publish steps; `make check-published-versions` runs it
locally.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import tomllib
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/release-crate.yml"
CRATE_DIRS = ("rust/crates", "rust/services")
USER_AGENT = "ferrumdeck-release-check (https://github.com/sattyamjjain/ferrumdeck)"


def workspace_version() -> str:
    data = tomllib.loads((ROOT / "Cargo.toml").read_text())
    return data["workspace"]["package"]["version"]


def publishable_crates() -> list[tuple[str, Path]]:
    """(published name, manifest path) for every crate without publish = false."""
    out: list[tuple[str, Path]] = []
    for parent in CRATE_DIRS:
        for manifest in sorted((ROOT / parent).glob("*/Cargo.toml")):
            data = tomllib.loads(manifest.read_text())
            pkg = data.get("package", {})
            if pkg.get("publish") is False:
                continue
            out.append((pkg["name"], manifest))
    return out


def walk_steps() -> set[str]:
    """Crate names the release workflow actually publishes."""
    text = WORKFLOW.read_text()
    return set(re.findall(r"cargo publish -p ([A-Za-z0-9_-]+)", text))


def crates_io_version(name: str) -> str | None:
    req = urllib.request.Request(
        f"https://crates.io/api/v1/crates/{name}", headers={"User-Agent": USER_AGENT}
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.load(resp)["crate"]["max_version"]
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--offline", action="store_true", help="skip crates.io; check wiring only")
    args = ap.parse_args()

    version = workspace_version()
    crates = publishable_crates()
    walk = walk_steps()
    errors: list[str] = []

    print(f"Workspace version: {version}")
    print(f"Publishable crates: {', '.join(n for n, _ in crates)}")

    # 1. Wiring: every publishable crate must be a step in the walk.
    for name, manifest in crates:
        if name not in walk:
            errors.append(
                f"{name} is publishable but has no `cargo publish -p {name}` step in "
                f"{WORKFLOW.relative_to(ROOT)}. Either add the step or set "
                f"`publish = false` in {manifest.relative_to(ROOT)} and say why. "
                "A crate that is neither is one nothing will ever ship."
            )

    # 2. Reality: every publishable crate must be ON crates.io at this version.
    if not args.offline:
        for name, _ in crates:
            try:
                live = crates_io_version(name)
            except Exception as exc:  # network trouble is not a claim failure
                print(f"  --  {name}: skipped (crates.io unreachable: {exc})")
                continue
            if live is None:
                errors.append(f"{name} is publishable but does not exist on crates.io.")
            elif live != version:
                errors.append(
                    f"{name} is on crates.io at {live}, workspace is at {version}. "
                    "The publish walk did not ship it — that is the silent failure this "
                    "check exists to make loud."
                )
            else:
                print(f"  OK  {name}: {live}")

    if errors:
        print("\nPUBLISHED-VERSION CHECK FAILED:", file=sys.stderr)
        for e in errors:
            print(f"  ::error:: {e}", file=sys.stderr)
        return 1
    print("\nOK — every publishable crate is wired into the walk and current on crates.io.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
