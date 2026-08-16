"""Scorer that asserts on the agent's own output text.

``regression.yaml`` has referenced ``expected_output_match`` since it was
written, but no such scorer existed -- the suite's scorer block was never
loaded, so nothing ever noticed. This implements it.

Unlike the artifact scorers (files changed, PR created, tests pass), this one
reads the agent's actual output, which the harness always has. It is therefore
a claim the eval can genuinely make.
"""

from __future__ import annotations

import json
import re
from typing import Any

from fd_evals.scorers.base import BaseScorer
from fd_evals.task import EvalTask, ScorerResult


def _as_text(output: str | dict[str, Any]) -> str:
    """Flatten an agent output into searchable text."""
    if isinstance(output, str):
        return output
    return json.dumps(output, sort_keys=True)


class ExpectedOutputMatchScorer(BaseScorer):
    """Check the agent's output against declarative expectations.

    Reads these optional keys from ``task.expected``:

    - ``contains``      -- list of substrings that must all appear (case-insensitive)
    - ``not_contains``  -- list of substrings that must not appear
    - ``regex``         -- pattern that must match
    - ``min_length``    -- minimum output length in characters

    When a task declares none of them there is nothing to assert, and the
    scorer skips with a full score rather than failing the task for a
    expectation its dataset never made.
    """

    EXPECTED_KEYS = ("contains", "not_contains", "regex", "min_length")

    def __init__(self, case_sensitive: bool = False, weight: float = 1.0):
        super().__init__(name="ExpectedOutputMatch", weight=weight)
        self.case_sensitive = case_sensitive

    def score(
        self,
        task: EvalTask,
        actual_output: str | dict[str, Any],
        run_context: dict[str, Any],
    ) -> ScorerResult:
        expected = task.expected or {}
        contains = list(expected.get("contains") or [])
        not_contains = list(expected.get("not_contains") or [])
        pattern = expected.get("regex")
        min_length = expected.get("min_length")

        if not (contains or not_contains or pattern or min_length):
            return ScorerResult(
                scorer_name=self.name,
                passed=True,
                score=1.0,
                message="No output expectations declared for this task",
                details={"skipped": True},
                skipped=True,
            )

        text = _as_text(actual_output)
        haystack = text if self.case_sensitive else text.lower()

        checks: list[bool] = []
        failures: list[str] = []

        for needle in contains:
            probe = needle if self.case_sensitive else needle.lower()
            ok = probe in haystack
            checks.append(ok)
            if not ok:
                failures.append(f"missing {needle!r}")

        for needle in not_contains:
            probe = needle if self.case_sensitive else needle.lower()
            ok = probe not in haystack
            checks.append(ok)
            if not ok:
                failures.append(f"forbidden {needle!r} present")

        if pattern:
            flags = 0 if self.case_sensitive else re.IGNORECASE
            ok = re.search(pattern, text, flags) is not None
            checks.append(ok)
            if not ok:
                failures.append(f"regex {pattern!r} did not match")

        if min_length:
            ok = len(text) >= int(min_length)
            checks.append(ok)
            if not ok:
                failures.append(f"output shorter than {min_length} chars (got {len(text)})")

        score = sum(1 for c in checks if c) / len(checks) if checks else 1.0
        passed = not failures

        return ScorerResult(
            scorer_name=self.name,
            passed=passed,
            score=score,
            message=("Output matched all expectations" if passed else "; ".join(failures)),
            details={
                "checks": len(checks),
                "failures": failures,
                "output_length": len(text),
            },
        )
