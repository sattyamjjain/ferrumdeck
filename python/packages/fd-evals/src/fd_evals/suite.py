"""Suite loading: dataset resolution, task filtering, and scorer construction.

Historically ``cli.py`` resolved a ``--suite`` name to nothing more than a
dataset path and then scored every run with a hardcoded default scorer set.
The ``scorers:`` and ``filter:`` blocks that suite authors wrote in
``evals/suites/*.yaml`` were parsed and thrown away, so the declared
assertions never ran. This module loads the whole suite instead.

Unknown scorer names raise. A suite that references a scorer we cannot build
is a broken suite, and silently substituting a different one is exactly how
the safe-PR eval reported 0% for forty consecutive nightly runs without anyone
being able to see why.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from fd_evals.scorers import (
    BaseScorer,
    BudgetComplianceScorer,
    ExpectedOutputMatchScorer,
    FilesChangedScorer,
    LintScorer,
    PolicyComplianceScorer,
    PRCreatedScorer,
    SchemaScorer,
    TestPassScorer,
    ToolAllowlistScorer,
)

# Maps the ``type:`` string used in suite YAML to the scorer class.
# Keep the YAML names stable; they are the public contract of a suite file.
SCORER_REGISTRY: dict[str, type[BaseScorer]] = {
    "schema_valid": SchemaScorer,
    "no_policy_violations": PolicyComplianceScorer,
    "budget_compliance": BudgetComplianceScorer,
    "tool_allowlist": ToolAllowlistScorer,
    "expected_output_match": ExpectedOutputMatchScorer,
    # Artifact-shaped scorers. These require a run context carrying real
    # PR/file/test data; see OBSERVABILITY_NOTE below.
    "files_changed": FilesChangedScorer,
    "pr_created": PRCreatedScorer,
    "tests_pass": TestPassScorer,
    "lint_pass": LintScorer,
}

# Scorers that read fields the control plane does not currently surface on a
# run. They are still selectable, but a suite that uses them is asserting on
# data the harness cannot observe, so we say so rather than scoring 0.
UNOBSERVABLE_SCORERS = frozenset({"files_changed", "pr_created", "tests_pass", "lint_pass"})


class SuiteError(Exception):
    """Raised when a suite file is missing, malformed, or unbuildable."""


@dataclass
class LoadedSuite:
    """A fully resolved suite: what to run, on what, and how to score it."""

    name: str
    dataset_path: Path
    scorers: list[BaseScorer]
    scorer_names: list[str] = field(default_factory=list)
    categories: list[str] | None = None
    tags: list[str] | None = None
    timeout_ms: int = 300_000
    max_parallel: int = 1
    gates: dict[str, Any] = field(default_factory=dict)
    suite_path: Path | None = None

    def matches(self, category: str | None, tags: list[str] | None) -> bool:
        """Return True when a task passes this suite's filter."""
        if self.categories is not None and category not in self.categories:
            return False
        if self.tags is not None and not (set(tags or []) & set(self.tags)):
            return False
        return True

    @property
    def unobservable(self) -> list[str]:
        """Names of selected scorers that read fields the harness cannot see."""
        return [n for n in self.scorer_names if n in UNOBSERVABLE_SCORERS]


def build_scorer(spec: dict[str, Any] | str) -> tuple[str, BaseScorer]:
    """Build one scorer from a suite YAML entry.

    Accepts either ``{type: schema_valid, weight: 2.0, config: {...}}`` or the
    bare string ``schema_valid``.
    """
    if isinstance(spec, str):
        name, weight, config = spec, 1.0, {}
    else:
        name = spec.get("type") or ""
        weight = float(spec.get("weight", 1.0))
        config = dict(spec.get("config") or {})

    if not name:
        raise SuiteError(f"Scorer entry is missing a 'type': {spec!r}")

    cls = SCORER_REGISTRY.get(name)
    if cls is None:
        known = ", ".join(sorted(SCORER_REGISTRY))
        raise SuiteError(f"Unknown scorer type {name!r}. Known scorers: {known}")

    try:
        return name, cls(weight=weight, **config)
    except TypeError as exc:
        raise SuiteError(f"Cannot build scorer {name!r} with config {config!r}: {exc}") from exc


def load_suite(suite: str, evals_dir: Path | None = None) -> LoadedSuite:
    """Load ``evals/suites/<suite>.yaml`` into a LoadedSuite.

    Raises SuiteError when the file, its dataset, or its scorers cannot be
    resolved -- a broken suite must fail loudly rather than silently running
    a different set of assertions than the one written down.
    """
    evals_dir = evals_dir or Path("evals")
    suite_file = evals_dir / "suites" / f"{suite}.yaml"

    if not suite_file.exists():
        # Directory-style suites (asb/, injection_defense/) keep suite.yaml inside.
        nested = evals_dir / "suites" / suite / "suite.yaml"
        if nested.exists():
            suite_file = nested
        else:
            raise SuiteError(f"No suite file for {suite!r} (looked for {suite_file} and {nested})")

    with suite_file.open() as fh:
        config = yaml.safe_load(fh) or {}

    datasets = config.get("datasets") or []
    if not datasets:
        raise SuiteError(f"Suite {suite!r} declares no datasets")

    first = datasets[0]
    dataset_path = evals_dir / first.get("path", "")
    tasks_file = dataset_path if dataset_path.is_file() else dataset_path / "tasks.jsonl"
    if not tasks_file.exists():
        raise SuiteError(f"Suite {suite!r} points at a missing dataset: {tasks_file}")

    dataset_filter = first.get("filter") or {}
    categories = dataset_filter.get("categories")
    tags = dataset_filter.get("tags")

    scorer_specs = config.get("scorers") or []
    scorers: list[BaseScorer] = []
    scorer_names: list[str] = []
    for spec in scorer_specs:
        name, scorer = build_scorer(spec)
        scorer_names.append(name)
        scorers.append(scorer)

    settings = config.get("settings") or {}

    return LoadedSuite(
        name=config.get("name") or suite,
        dataset_path=tasks_file,
        scorers=scorers,
        scorer_names=scorer_names,
        categories=categories,
        tags=tags,
        timeout_ms=int(settings.get("timeout_ms", 300_000)),
        max_parallel=int(settings.get("max_parallel", 1)),
        gates=config.get("gates") or {},
        suite_path=suite_file,
    )
