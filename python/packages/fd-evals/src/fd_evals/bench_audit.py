"""Benchmark-audit pre-flight for fd-evals.

A deterministic, CI-stable hygiene auditor that scores an eval suite (its task
metadata + grader config) against the **ABA** hygiene classes before any
external benchmark delta is allowed to gate a routing/model-swap decision.

Anchor: *Are Benchmarks Aware? Auditing the Hygiene of LLM Evaluation Suites*,
arXiv:[2605.26079](https://arxiv.org/abs/2605.26079).

The four hygiene classes audited here are:

1. ``ambiguous_spec``    — under-specified or vague task input.
2. ``env_conflict``      — execution-environment conflicts / hidden deps.
3. ``brittle_grading``   — brittle, ambiguous, or orphaned grader configuration.
4. ``suspect_truth``     — missing or suspect ground truth.

This is **not** an LLM judge — every check is a pure function over the suite's
own YAML, the task JSONL, and the active scorer list. Same inputs → same
``bench_trust_score`` on every CI run.

The output is a :class:`BenchAuditReport`; downstream the Rust policy plane
consumes the ``bench_trust_score`` + the flagged task IDs to decide whether a
benchmark-delta-cited routing change is allowed to gate.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import Enum
from pathlib import Path
from typing import Any

from fd_evals.task import EvalTask

logger = logging.getLogger(__name__)

# Stable arXiv anchor recorded on every report so audit consumers can cite the
# source without re-fetching this docstring.
BENCH_AUDIT_ANCHOR = "arXiv:2605.26079"

# Tokens that indicate a verb-shaped instruction. Conservative: missing a verb
# isn't a hard fail on its own, but combined with other ambiguity signals it
# drives the score down.
_ACTION_VERBS = frozenset(
    {
        "add",
        "remove",
        "delete",
        "create",
        "update",
        "fix",
        "refactor",
        "implement",
        "rename",
        "replace",
        "convert",
        "extract",
        "inline",
        "migrate",
        "document",
        "review",
        "validate",
        "verify",
        "configure",
        "deploy",
        "patch",
        "rewrite",
        "format",
        "lint",
        "test",
        "audit",
        "harden",
        "optimize",
    }
)

# Vague placeholders / pronouns whose presence in a task spec is a strong
# ambiguity signal.
_VAGUE_TOKENS = re.compile(
    r"\b(this|that|something|anything|stuff|things?|appropriate|reasonable|sensible)\b",
    re.IGNORECASE,
)

# Unresolved template markers — `<...>`, `{{...}}`, `TODO`, `TBD`, `FIXME`.
_PLACEHOLDER_MARKERS = re.compile(
    r"(<[A-Za-z_][A-Za-z0-9_\s-]*>|\{\{[^}]+\}\}|\bTODO\b|\bTBD\b|\bFIXME\b)"
)

# Environment-variable shaped tokens that the suite doesn't declare anywhere —
# e.g. `$FOO` or `${BAR}` appearing in task inputs.
_ENV_VAR_LIKE = re.compile(r"\$[A-Z_][A-Z0-9_]*|\$\{[A-Z_][A-Z0-9_]*\}")

# Expected-output keys whose value is a wildcard or glob — typically a sign of
# loose ground truth (e.g. `alembic/versions/*.py`).
_WILDCARD_PATH = re.compile(r"[*?\[\]]")

# Minimum task-input character count before a spec is considered too short to
# describe real work. Calibrated against the safe-pr-agent dataset, where every
# task is at least 40 chars.
_MIN_SPEC_LENGTH = 24


class HygieneClass(str, Enum):
    """The four ABA-style hygiene classes audited per task."""

    AMBIGUOUS_SPEC = "ambiguous_spec"
    ENV_CONFLICT = "env_conflict"
    BRITTLE_GRADING = "brittle_grading"
    SUSPECT_TRUTH = "suspect_truth"


class FlagSeverity(str, Enum):
    """Severity assigned to a single hit. Drives the penalty weight."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


# Severity → penalty (per-class, capped at 1.0 per class per task) — tuned so
# a single high-severity hit drops a class to ~0 trust and a low-severity hit
# only nudges it.
_SEVERITY_PENALTY: dict[FlagSeverity, float] = {
    FlagSeverity.LOW: 0.15,
    FlagSeverity.MEDIUM: 0.40,
    FlagSeverity.HIGH: 1.00,
}


@dataclass
class TaskFlag:
    """A single hygiene hit against a task.

    A task can accumulate multiple flags across classes; each flag carries the
    evidence string so auditors can debug why a suite lost trust.
    """

    task_id: str
    hygiene_class: HygieneClass
    severity: FlagSeverity
    evidence: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "hygiene_class": self.hygiene_class.value,
            "severity": self.severity.value,
            "evidence": self.evidence,
        }


@dataclass
class BenchAuditReport:
    """The full benchmark-audit report emitted before a delta can gate routing.

    ``bench_trust_score`` is in ``[0.0, 1.0]``; the Rust policy plane denies a
    benchmark-gated routing decision when this value sits below the configured
    minimum (see ``fd_policy::bench_audit::BenchAuditPolicy``).
    """

    suite_id: str
    suite_path: str | None
    bench_trust_score: float
    flagged_task_ids: list[str]
    task_flags: list[TaskFlag]
    hygiene_class_scores: dict[str, float]
    total_tasks: int
    audited_at: datetime = field(default_factory=lambda: datetime.now(tz=UTC))
    anchor: str = BENCH_AUDIT_ANCHOR

    @property
    def flagged_task_ratio(self) -> float:
        """Share of tasks with at least one flag. Surfaced on the dashboard."""
        if self.total_tasks == 0:
            return 0.0
        return len(self.flagged_task_ids) / self.total_tasks

    def to_dict(self) -> dict[str, Any]:
        return {
            "suite_id": self.suite_id,
            "suite_path": self.suite_path,
            "bench_trust_score": round(self.bench_trust_score, 4),
            "flagged_task_ids": self.flagged_task_ids,
            "flagged_task_ratio": round(self.flagged_task_ratio, 4),
            "task_flags": [f.to_dict() for f in self.task_flags],
            "hygiene_class_scores": {k: round(v, 4) for k, v in self.hygiene_class_scores.items()},
            "total_tasks": self.total_tasks,
            "audited_at": self.audited_at.isoformat(),
            "anchor": self.anchor,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> BenchAuditReport:
        flags = [
            TaskFlag(
                task_id=f["task_id"],
                hygiene_class=HygieneClass(f["hygiene_class"]),
                severity=FlagSeverity(f["severity"]),
                evidence=f["evidence"],
            )
            for f in data.get("task_flags", [])
        ]
        audited_at_raw = data.get("audited_at")
        audited_at = (
            datetime.fromisoformat(audited_at_raw) if audited_at_raw else datetime.now(tz=UTC)
        )
        return cls(
            suite_id=data["suite_id"],
            suite_path=data.get("suite_path"),
            bench_trust_score=float(data["bench_trust_score"]),
            flagged_task_ids=list(data.get("flagged_task_ids", [])),
            task_flags=flags,
            hygiene_class_scores=dict(data.get("hygiene_class_scores", {})),
            total_tasks=int(data.get("total_tasks", 0)),
            audited_at=audited_at,
            anchor=data.get("anchor", BENCH_AUDIT_ANCHOR),
        )


class BenchAuditor:
    """Deterministic hygiene auditor for an eval suite.

    The auditor takes the suite's own task metadata + scorer config and returns
    a :class:`BenchAuditReport`. No LLM is consulted — every signal is a pure
    function over the input artefacts. Inject ``scorer_keys`` to model which
    keys of ``EvalTask.expected`` the active scorer set actually consumes; an
    orphan key (in ``expected`` but consumed by no scorer) is recorded as a
    ``brittle_grading`` hit because the scorer will silently pass when the
    agent forgets to set it.
    """

    def __init__(
        self,
        *,
        scorer_consumed_keys: set[str] | None = None,
        declared_env_vars: set[str] | None = None,
    ) -> None:
        # Default: the union of expected-keys the built-in safe-pr-agent
        # scorers actually look at. Callers with custom scorers should pass
        # their own.
        self.scorer_consumed_keys = scorer_consumed_keys or {
            "files_changed",
            "files_created",
            "pr_created",
            "tests_pass",
            "lint_pass",
            "schema",
        }
        self.declared_env_vars = declared_env_vars or set()

    # -------------------------------------------------------------------------
    # Public entry points
    # -------------------------------------------------------------------------

    def audit_tasks(
        self,
        tasks: list[EvalTask],
        *,
        suite_id: str,
        suite_path: str | None = None,
    ) -> BenchAuditReport:
        """Score a list of pre-loaded tasks against the ABA hygiene classes."""
        all_flags: list[TaskFlag] = []
        flagged_ids: set[str] = set()

        seen_inputs: dict[str, str] = {}
        seen_ids: dict[str, int] = {}

        for task in tasks:
            seen_ids[task.id] = seen_ids.get(task.id, 0) + 1
            input_signature = json.dumps(task.input, sort_keys=True)
            if input_signature in seen_inputs and seen_inputs[input_signature] != task.id:
                all_flags.append(
                    TaskFlag(
                        task_id=task.id,
                        hygiene_class=HygieneClass.SUSPECT_TRUTH,
                        severity=FlagSeverity.MEDIUM,
                        evidence=(
                            f"duplicate input shared with task '{seen_inputs[input_signature]}'"
                        ),
                    )
                )
                flagged_ids.add(task.id)
            else:
                seen_inputs.setdefault(input_signature, task.id)

            task_flags = self._audit_single_task(task)
            if task_flags:
                flagged_ids.add(task.id)
            all_flags.extend(task_flags)

        for task_id, count in seen_ids.items():
            if count > 1:
                all_flags.append(
                    TaskFlag(
                        task_id=task_id,
                        hygiene_class=HygieneClass.SUSPECT_TRUTH,
                        severity=FlagSeverity.HIGH,
                        evidence=f"duplicate task id appears {count} times in suite",
                    )
                )
                flagged_ids.add(task_id)

        hygiene_class_scores = self._aggregate_class_scores(all_flags, len(tasks))
        bench_trust_score = (
            sum(hygiene_class_scores.values()) / len(hygiene_class_scores)
            if hygiene_class_scores
            else 1.0
        )

        return BenchAuditReport(
            suite_id=suite_id,
            suite_path=suite_path,
            bench_trust_score=bench_trust_score,
            flagged_task_ids=sorted(flagged_ids),
            task_flags=all_flags,
            hygiene_class_scores=hygiene_class_scores,
            total_tasks=len(tasks),
        )

    def audit_dataset(
        self,
        dataset_path: str | Path,
        *,
        suite_id: str | None = None,
        suite_path: str | None = None,
    ) -> BenchAuditReport:
        """Convenience: load tasks from a JSONL file and audit them."""
        dataset_path = Path(dataset_path)
        tasks: list[EvalTask] = []
        with dataset_path.open() as fh:
            for line in fh:
                stripped = line.strip()
                if not stripped:
                    continue
                tasks.append(EvalTask.from_dict(json.loads(stripped)))
        return self.audit_tasks(
            tasks,
            suite_id=suite_id or dataset_path.parent.name,
            suite_path=suite_path,
        )

    # -------------------------------------------------------------------------
    # Per-task checks (one per hygiene class)
    # -------------------------------------------------------------------------

    def _audit_single_task(self, task: EvalTask) -> list[TaskFlag]:
        flags: list[TaskFlag] = []
        flags.extend(self._check_ambiguous_spec(task))
        flags.extend(self._check_env_conflict(task))
        flags.extend(self._check_brittle_grading(task))
        flags.extend(self._check_suspect_truth(task))
        return flags

    def _check_ambiguous_spec(self, task: EvalTask) -> list[TaskFlag]:
        flags: list[TaskFlag] = []
        spec = self._extract_spec_text(task)

        if len(spec) < _MIN_SPEC_LENGTH:
            flags.append(
                TaskFlag(
                    task_id=task.id,
                    hygiene_class=HygieneClass.AMBIGUOUS_SPEC,
                    severity=FlagSeverity.HIGH,
                    evidence=(
                        f"task spec is {len(spec)} chars; below the {_MIN_SPEC_LENGTH}-char "
                        f"floor for an evaluable instruction"
                    ),
                )
            )

        spec_lower = spec.lower()
        verbs_present = any(verb in spec_lower.split() for verb in _ACTION_VERBS)
        if not verbs_present and spec:
            flags.append(
                TaskFlag(
                    task_id=task.id,
                    hygiene_class=HygieneClass.AMBIGUOUS_SPEC,
                    severity=FlagSeverity.MEDIUM,
                    evidence="task spec contains no recognised action verb",
                )
            )

        vague_hits = _VAGUE_TOKENS.findall(spec)
        if len(vague_hits) >= 2:
            flags.append(
                TaskFlag(
                    task_id=task.id,
                    hygiene_class=HygieneClass.AMBIGUOUS_SPEC,
                    severity=FlagSeverity.MEDIUM,
                    evidence=f"task spec contains {len(vague_hits)} vague tokens: {vague_hits}",
                )
            )

        placeholders = _PLACEHOLDER_MARKERS.findall(spec)
        if placeholders:
            flags.append(
                TaskFlag(
                    task_id=task.id,
                    hygiene_class=HygieneClass.AMBIGUOUS_SPEC,
                    severity=FlagSeverity.HIGH,
                    evidence=f"unresolved placeholder(s) in task spec: {placeholders}",
                )
            )

        return flags

    def _check_env_conflict(self, task: EvalTask) -> list[TaskFlag]:
        flags: list[TaskFlag] = []
        spec = self._extract_spec_text(task)

        for env_token in _ENV_VAR_LIKE.findall(spec):
            normalized = env_token.lstrip("$").strip("{}")
            if normalized not in self.declared_env_vars:
                flags.append(
                    TaskFlag(
                        task_id=task.id,
                        hygiene_class=HygieneClass.ENV_CONFLICT,
                        severity=FlagSeverity.HIGH,
                        evidence=(
                            f"task references env var '{env_token}' that is not "
                            f"declared by the suite"
                        ),
                    )
                )

        # A task that asks for a specific branch or repo but doesn't say which —
        # e.g. the input has a `branch` key but no value, or value is empty.
        for required_key in ("branch", "repo"):
            value = task.input.get(required_key)
            if required_key in task.input and (value is None or value == ""):
                flags.append(
                    TaskFlag(
                        task_id=task.id,
                        hygiene_class=HygieneClass.ENV_CONFLICT,
                        severity=FlagSeverity.MEDIUM,
                        evidence=f"task input declares '{required_key}' but leaves it empty",
                    )
                )

        return flags

    def _check_brittle_grading(self, task: EvalTask) -> list[TaskFlag]:
        flags: list[TaskFlag] = []
        expected = task.expected or {}

        if expected:
            orphan_keys = [
                k
                for k in expected.keys()
                if k not in self.scorer_consumed_keys
                # Tolerate keys that *look* like a known scorer dimension —
                # ones the active scorer set just doesn't enumerate by name.
                and not k.startswith("_")
            ]
            if orphan_keys:
                # Severity scales with how many keys are orphaned: 1 → low, 2 →
                # medium, 3+ → high. An orphan key is a silent-pass risk.
                severity = (
                    FlagSeverity.LOW
                    if len(orphan_keys) == 1
                    else FlagSeverity.MEDIUM
                    if len(orphan_keys) == 2
                    else FlagSeverity.HIGH
                )
                flags.append(
                    TaskFlag(
                        task_id=task.id,
                        hygiene_class=HygieneClass.BRITTLE_GRADING,
                        severity=severity,
                        evidence=(
                            f"expected key(s) not consumed by any active scorer: "
                            f"{sorted(orphan_keys)}"
                        ),
                    )
                )

        # Conflicting boolean expectations within the same task — e.g. one nested
        # block says `tests_pass: true` and another says `tests_pass: false`.
        # Flat keys can't conflict with themselves, but nested ones can.
        for key, value in expected.items():
            if isinstance(value, dict):
                nested = value.get(key)
                if nested is not None and nested != value.get("expected", nested):
                    flags.append(
                        TaskFlag(
                            task_id=task.id,
                            hygiene_class=HygieneClass.BRITTLE_GRADING,
                            severity=FlagSeverity.HIGH,
                            evidence=f"nested expected['{key}'] contradicts itself",
                        )
                    )

        # `regex` + `contains` on the same expected block — overlapping graders
        # can silently fight each other and produce non-deterministic results.
        if "regex" in expected and "contains" in expected:
            flags.append(
                TaskFlag(
                    task_id=task.id,
                    hygiene_class=HygieneClass.BRITTLE_GRADING,
                    severity=FlagSeverity.MEDIUM,
                    evidence="expected mixes regex and contains graders on the same task",
                )
            )

        return flags

    def _check_suspect_truth(self, task: EvalTask) -> list[TaskFlag]:
        flags: list[TaskFlag] = []
        expected = task.expected or {}

        if not expected:
            flags.append(
                TaskFlag(
                    task_id=task.id,
                    hygiene_class=HygieneClass.SUSPECT_TRUTH,
                    severity=FlagSeverity.HIGH,
                    evidence="task has no expected ground truth — silent pass risk",
                )
            )
            return flags

        files = expected.get("files_changed") or expected.get("files_created") or []
        if isinstance(files, list):
            for entry in files:
                if isinstance(entry, str) and _WILDCARD_PATH.search(entry):
                    flags.append(
                        TaskFlag(
                            task_id=task.id,
                            hygiene_class=HygieneClass.SUSPECT_TRUTH,
                            severity=FlagSeverity.MEDIUM,
                            evidence=(
                                f"expected files include wildcard path '{entry}'; "
                                f"ground truth is loose"
                            ),
                        )
                    )

        # All-True boolean expectations with no negative cases — a suite that
        # never expects a `False` outcome can't distinguish a working agent
        # from one that hardcodes `True`.
        bool_values = [v for v in expected.values() if isinstance(v, bool)]
        if bool_values and all(v is True for v in bool_values) and len(bool_values) >= 3:
            flags.append(
                TaskFlag(
                    task_id=task.id,
                    hygiene_class=HygieneClass.SUSPECT_TRUTH,
                    severity=FlagSeverity.LOW,
                    evidence=(
                        f"all {len(bool_values)} boolean expectations are True; "
                        f"task can't catch a hardcoded-True agent"
                    ),
                )
            )

        return flags

    # -------------------------------------------------------------------------
    # Aggregation
    # -------------------------------------------------------------------------

    def _aggregate_class_scores(
        self,
        flags: list[TaskFlag],
        total_tasks: int,
    ) -> dict[str, float]:
        """Aggregate per-class penalties → per-class trust score in [0, 1].

        The penalty for a single (task, class) pair is capped at 1.0 so a single
        bad task can't drag a class arbitrarily negative. The class score is
        then ``1 - mean(per_task_penalty)`` clamped to ``[0, 1]``.
        """
        if total_tasks == 0:
            return {cls.value: 1.0 for cls in HygieneClass}

        per_class_per_task: dict[HygieneClass, dict[str, float]] = {cls: {} for cls in HygieneClass}
        for flag in flags:
            bucket = per_class_per_task[flag.hygiene_class]
            bucket[flag.task_id] = min(
                1.0, bucket.get(flag.task_id, 0.0) + _SEVERITY_PENALTY[flag.severity]
            )

        scores: dict[str, float] = {}
        for cls, per_task in per_class_per_task.items():
            total_penalty = sum(per_task.values())
            mean_penalty = total_penalty / total_tasks
            scores[cls.value] = max(0.0, min(1.0, 1.0 - mean_penalty))
        return scores

    # -------------------------------------------------------------------------
    # Helpers
    # -------------------------------------------------------------------------

    @staticmethod
    def _extract_spec_text(task: EvalTask) -> str:
        """Pull the human-readable instruction out of a task.

        We look at ``task.input.task`` first (the safe-pr-agent convention),
        then fall back to ``description`` and finally to a JSON-stringified
        form of the input. The fallback ensures the auditor still has something
        to scan even when a suite uses a non-standard input shape.
        """
        raw_task = task.input.get("task") if isinstance(task.input, dict) else None
        if isinstance(raw_task, str) and raw_task.strip():
            return raw_task.strip()
        if task.description:
            return task.description.strip()
        return json.dumps(task.input, sort_keys=True)


# -----------------------------------------------------------------------------
# I/O helpers
# -----------------------------------------------------------------------------


def save_report(report: BenchAuditReport, path: str | Path) -> None:
    """Persist a :class:`BenchAuditReport` to disk as JSON."""
    out_path = Path(path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w") as fh:
        json.dump(report.to_dict(), fh, indent=2)
    logger.info("Saved bench-audit report to %s", out_path)


def load_report(path: str | Path) -> BenchAuditReport:
    """Load a :class:`BenchAuditReport` from disk."""
    in_path = Path(path)
    with in_path.open() as fh:
        return BenchAuditReport.from_dict(json.load(fh))


__all__ = [
    "BENCH_AUDIT_ANCHOR",
    "BenchAuditReport",
    "BenchAuditor",
    "FlagSeverity",
    "HygieneClass",
    "TaskFlag",
    "load_report",
    "save_report",
]
