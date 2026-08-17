#!/usr/bin/env python3
"""Fail if a declared eval suite is not reachable from any workflow trigger.

The "exists but never executed" class, third instance. `regression` sat in
`evals/suites/` for months while the nightly cron only ever ran `smoke`, so the
suite was declared, referenced in the docs, and never once run. That was fixed
by adding a second cron -- fixing the instance, not the class. This closes the
class: a suite that no workflow can reach fails the build.

## What "reachable" means

A suite is reachable if some file in `.github/workflows/` can cause it to run.
Three ways, because the repo genuinely uses all three:

1. Directly, as `--suite <name>` in a workflow step.
2. Through a shell variable that is assigned a literal somewhere in the same
   workflow -- `evals.yml` selects `SUITE="regression"` or `SUITE="smoke"` off
   `github.event.schedule`, then passes `--suite "$SUITE"`.
3. Through `make <target>`, where the Makefile recipe names the suite. This is
   how `asb` and `injection_defense` run: `ci.yml` calls
   `make eval-injection-defense && make eval-asb`, and those recipes carry the
   `--suite` flag.

Case 3 is why this checker does not just read the nightly workflow. Only
`smoke` and `regression` live in `evals.yml`. The deterministic governance
suites are gated on every push and PR from `ci.yml` instead, which is a
deliberate split (see the header comment in `evals.yml`): fast + offline on
PRs, slow + LLM-backed on a schedule. A checker that diffed the declared
suites against the nightly alone would report both as unreachable and would be
wrong about the two suites that gate most rigorously.

Exit 0 when every declared suite is reachable, 1 otherwise. No skip flag: this
runs in the same job as the tests, following the `eval-health-check`
precedent, and a gate with a bypass is a lint.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# `--suite X`, `--suite=X`, quoted or bare. Captures the value, which may be a
# bare name (`asb`), a path (`evals/suites/smoke.yaml`), or a shell var (`$SUITE`).
SUITE_FLAG_RE = re.compile(r"--suite[=\s]+[\"']?([^\s\"']+)[\"']?")

# `SUITE="regression"` / `SUITE=regression` -- a literal assigned to a variable
# that is later passed to --suite. Deliberately narrow: only assignments of a
# literal, never an expression, because resolving arbitrary shell is not
# something this check should pretend to do.
SHELL_ASSIGN_RE = re.compile(r"^\s*([A-Z_][A-Z0-9_]*)=[\"']?([A-Za-z0-9_./-]+)[\"']?\s*$", re.M)

# `make foo` / `make foo bar` in a run: block.
MAKE_CALL_RE = re.compile(r"\bmake\s+([a-z0-9][a-z0-9-]*(?:\s+[a-z0-9][a-z0-9-]*)*)")


def declared_suites(suites_dir: Path) -> dict[str, Path]:
    """Map suite name -> defining file, for every suite under evals/suites/.

    Two layouts are in use: a flat `<name>.yaml` and a nested
    `<name>/suite.yaml`. The suite's own `name:` field wins when present, since
    that is what `--suite` resolves against; the path is only a fallback.
    """
    found: dict[str, Path] = {}
    for path in sorted(suites_dir.rglob("*.yaml")):
        name = None
        for line in path.read_text().splitlines():
            m = re.match(r"^name:\s*[\"']?([A-Za-z0-9_-]+)[\"']?\s*$", line)
            if m:
                name = m.group(1)
                break
        if name is None:
            name = path.parent.name if path.stem == "suite" else path.stem
        found[name] = path
    return found


def normalize(token: str) -> str:
    """Reduce a --suite value to a suite name.

    `evals/suites/smoke.yaml` -> `smoke`; `evals/suites/asb/suite.yaml` -> `asb`;
    a bare name passes through.
    """
    if "/" in token or token.endswith(".yaml"):
        p = Path(token)
        return p.parent.name if p.stem == "suite" else p.stem
    return token


def makefile_recipes(makefile: Path) -> dict[str, str]:
    """Parse the Makefile into {target: recipe text}."""
    recipes: dict[str, str] = {}
    target = None
    body: list[str] = []
    for line in makefile.read_text().splitlines():
        m = re.match(r"^([a-zA-Z0-9_-]+):", line)
        if m:
            if target:
                recipes[target] = "\n".join(body)
            target = m.group(1)
            body = []
        elif target and (line.startswith("\t") or line.startswith("    ")):
            body.append(line)
        elif target and not line.strip():
            continue
        elif target:
            recipes[target] = "\n".join(body)
            target = None
            body = []
    if target:
        recipes[target] = "\n".join(body)
    return recipes


def suites_named_in(text: str) -> set[str]:
    """Suite names a block of text can invoke, resolving one level of shell var."""
    literals = {v for _, v in SHELL_ASSIGN_RE.findall(text)}
    names: set[str] = set()
    for raw in SUITE_FLAG_RE.findall(text):
        if raw.startswith("$"):
            # `--suite "$SUITE"`: admit every literal assigned in this file.
            # Over-admits if two variables coexist, which is the safe direction
            # for a gate whose false positive is a broken build.
            names |= {normalize(v) for v in literals}
        else:
            names.add(normalize(raw))
    return names


def reachable_suites(workflows: Path, makefile: Path) -> dict[str, set[str]]:
    """Map suite name -> set of workflow files that can reach it."""
    recipes = makefile_recipes(makefile) if makefile.exists() else {}
    reach: dict[str, set[str]] = {}

    for wf in sorted(workflows.glob("*.yml")) + sorted(workflows.glob("*.yaml")):
        text = wf.read_text()
        names = suites_named_in(text)
        # Follow `make <target>` one level into the Makefile.
        for call in MAKE_CALL_RE.findall(text):
            for target in call.split():
                if target in recipes:
                    names |= suites_named_in(recipes[target])
        for n in names:
            reach.setdefault(n, set()).add(wf.name)
    return reach


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--suites", type=Path, default=Path("evals/suites"))
    ap.add_argument("--workflows", type=Path, default=Path(".github/workflows"))
    ap.add_argument("--makefile", type=Path, default=Path("Makefile"))
    args = ap.parse_args()

    if not args.suites.is_dir():
        print(f"No suites directory at {args.suites}", file=sys.stderr)
        return 1
    if not args.workflows.is_dir():
        print(f"No workflows directory at {args.workflows}", file=sys.stderr)
        return 1

    declared = declared_suites(args.suites)
    if not declared:
        print(f"No suites found under {args.suites}", file=sys.stderr)
        return 1

    reach = reachable_suites(args.workflows, args.makefile)
    orphans = {name: path for name, path in declared.items() if name not in reach}

    width = max(len(n) for n in declared)
    for name, path in sorted(declared.items()):
        where = ", ".join(sorted(reach.get(name, ())))
        status = "OK  " if name in reach else "FAIL"
        print(f"  {status} {name:<{width}}  {where or 'no workflow can reach it'}  ({path})")

    if orphans:
        # The table above goes to stdout and the diagnosis below to stderr;
        # without this flush the two interleave and the failure prints before
        # the rows that explain it.
        sys.stdout.flush()
        print(file=sys.stderr)
        for name, path in sorted(orphans.items()):
            print(
                f"UNREACHABLE: suite {name!r} ({path}) is declared but no workflow can run it.",
                file=sys.stderr,
            )
        print(
            "\nA suite nothing triggers is a suite that never runs, and it will "
            "report NEVER RUN on docs/eval-health.md rather than failing anything. "
            "Add it to a cron branch in .github/workflows/evals.yml, or invoke it "
            "from a make target that a workflow already calls.",
            file=sys.stderr,
        )
        return 1

    print(f"\nOK — all {len(declared)} declared suites are reachable from a workflow.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
