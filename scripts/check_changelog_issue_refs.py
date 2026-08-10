#!/usr/bin/env python3
"""Assert that issue references in the CHANGELOG's [Unreleased] section agree with
live GitHub issue state.

Why only [Unreleased]? A released section (`## [x.y.z]`) is frozen history: its
issue-state claims were true *at release time*, and an issue open then can
legitimately close later — so checking a released section against *current* state
would flag correct history as drift. The section that must match live state is the
one you are about to ship, `[Unreleased]`. Verifying it on every PR is what stops a
stale open/closed claim from ever reaching a release. (The motivating case —
`#5` claimed "stays open" while it was closed — was an issue accidentally closed one
second after release; the fix was to re-open the issue, and this guard prevents the
class going forward.)

A "claim" is only asserted when the prose is explicit:
  - CLOSED claim: a GitHub closing keyword immediately before the ref
    (`closes #N`, `fixes #N`, `resolves #N`, incl. -s/-d forms). The bare word
    "closed" (e.g. "was closed by accident") is deliberately NOT a closed-claim.
  - OPEN claim: the ref shares a line with an open-signal word
    (open / stays open / tracked / roadmap / not implemented / pending / deferred).
Refs with no explicit claim (a bare `[#7](…)` link) are reported and skipped.

Network-resilient: if GitHub cannot be reached (offline / rate-limited), it warns
and exits 0 — it fails the build only on a genuine claim-vs-state mismatch.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

CHANGELOG = Path(__file__).resolve().parent.parent / "CHANGELOG.md"

CLOSING_REF_RE = re.compile(r"\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b", re.I)
OPEN_SIGNAL = re.compile(
    r"\b(?:open|stays open|still open|remains open|tracked|roadmap|"
    r"not implemented|unbuilt|pending|deferred|wip)\b",
    re.I,
)
ANY_REF = re.compile(r"#(\d+)\b")


def unreleased_section(text: str) -> str:
    """Return the body of the first `## [Unreleased]` block, up to the next `## [`."""
    lines = text.splitlines()
    start = None
    for i, ln in enumerate(lines):
        if re.match(r"^##\s+\[Unreleased\]", ln, re.I):
            start = i + 1
            break
    if start is None:
        return ""
    body = []
    for ln in lines[start:]:
        if re.match(r"^##\s+\[", ln):
            break
        body.append(ln)
    return "\n".join(body)


def classify_claims(section: str) -> dict[int, str]:
    """Map issue number -> 'closed' | 'open' for refs that make an explicit claim."""
    claims: dict[int, str] = {}
    # Closed claims win (a closing keyword is a deliberate declaration).
    for m in CLOSING_REF_RE.finditer(section):
        claims[int(m.group(1))] = "closed"
    # Open claims, per line, for refs not already claimed closed.
    for line in section.splitlines():
        if not OPEN_SIGNAL.search(line):
            continue
        for m in ANY_REF.finditer(line):
            n = int(m.group(1))
            claims.setdefault(n, "open")
    return claims


def repo_slug() -> str:
    env = os.environ.get("GITHUB_REPOSITORY")
    if env:
        return env
    try:
        url = subprocess.run(
            ["git", "config", "--get", "remote.origin.url"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return "sattyamjjain/ferrumdeck"
    # strip creds + scheme + .git, keep owner/repo
    url = re.sub(r"^https?://[^@]*@", "https://", url)
    m = re.search(r"github\.com[/:]([^/]+/[^/]+?)(?:\.git)?$", url)
    return m.group(1) if m else "sattyamjjain/ferrumdeck"


class Unreachable(Exception):
    pass


def fetch_state(repo: str, number: int) -> str:
    """Return 'open' | 'closed'. Raise Unreachable on a network/API failure."""
    # Prefer gh (authenticated in CI + locally, higher rate limit).
    try:
        out = subprocess.run(
            ["gh", "api", f"repos/{repo}/issues/{number}", "--jq", ".state"],
            capture_output=True,
            text=True,
        )
        if out.returncode == 0 and out.stdout.strip() in ("open", "closed"):
            return out.stdout.strip()
    except FileNotFoundError:
        pass
    # Fallback: public REST API (repo is public). Token raises the rate limit.
    req = urllib.request.Request(f"https://api.github.com/repos/{repo}/issues/{number}")
    req.add_header("Accept", "application/vnd.github+json")
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.load(resp)["state"]
    except (urllib.error.URLError, TimeoutError, KeyError, json.JSONDecodeError) as e:
        raise Unreachable(str(e)) from e


def main() -> int:
    text = CHANGELOG.read_text()
    section = unreleased_section(text)
    if not section.strip():
        print("CHANGELOG [Unreleased] is empty — no issue references to check.")
        return 0

    claims = classify_claims(section)
    all_refs = sorted({int(m.group(1)) for m in ANY_REF.finditer(section)})
    unclaimed = [n for n in all_refs if n not in claims]

    print(f"CHANGELOG [Unreleased] issue references: {all_refs or 'none'}")
    if unclaimed:
        print(f"  (no explicit open/closed claim, skipped: {unclaimed})")
    if not claims:
        print("No explicit open/closed issue claims to verify.")
        return 0

    repo = repo_slug()
    errors: list[str] = []
    for number in sorted(claims):
        claimed = claims[number]
        try:
            actual = fetch_state(repo, number)
        except Unreachable as e:
            print(f"  ??  #{number}: GitHub unreachable ({e}) — skipping (not a failure).")
            continue
        ok = actual == claimed
        print(f"  {'OK ' if ok else 'BAD'} #{number}: changelog claims {claimed}, GitHub is {actual}")
        if not ok:
            errors.append(
                f"#{number}: CHANGELOG [Unreleased] claims '{claimed}' but the issue is "
                f"'{actual}' on GitHub."
            )

    if errors:
        print()
        for e in errors:
            print(f"::error::changelog issue drift: {e}")
        print(
            "\nFix the CHANGELOG claim to match reality, or change the issue's state "
            "if the claim is the intended one."
        )
        return 1
    print("\nEvery explicit [Unreleased] issue claim matches GitHub.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
