"""Scoring functions for evaluations."""

from abc import ABC, abstractmethod
from typing import Any

from pydantic import BaseModel


class ScoreResult(BaseModel):
    """Result of scoring."""

    score: float  # 0.0 to 1.0
    passed: bool
    reason: str | None = None
    metadata: dict[str, Any] | None = None


class Scorer(ABC):
    """Base class for evaluation scorers."""

    @abstractmethod
    def score(self, actual: Any, expected: Any) -> ScoreResult:
        """Score the actual output against expected."""
        pass


class ExactMatchScorer(Scorer):
    """Score based on exact match."""

    def score(self, actual: Any, expected: Any) -> ScoreResult:
        passed = actual == expected
        return ScoreResult(
            score=1.0 if passed else 0.0,
            passed=passed,
            reason="exact match" if passed else "mismatch",
        )


class ContainsScorer(Scorer):
    """Score based on whether actual contains expected."""

    def score(self, actual: Any, expected: Any) -> ScoreResult:
        if (isinstance(actual, str) and isinstance(expected, str)) or isinstance(actual, (list, set)):
            passed = expected in actual
        elif isinstance(actual, dict) and isinstance(expected, dict):
            passed = all(actual.get(k) == v for k, v in expected.items())
        else:
            passed = False

        return ScoreResult(
            score=1.0 if passed else 0.0,
            passed=passed,
            reason="contains expected" if passed else "does not contain expected",
        )


class SchemaValidScorer(Scorer):
    """Score based on JSON schema validation."""

    def __init__(self, schema: dict[str, Any]):
        self.schema = schema

    def score(self, actual: Any, expected: Any) -> ScoreResult:
        # expected is ignored for schema validation
        _ = expected  # unused
        # TODO: Implement JSON schema validation
        # For now, just check if it's a dict
        passed = isinstance(actual, dict)
        return ScoreResult(
            score=1.0 if passed else 0.0,
            passed=passed,
            reason="valid schema" if passed else "invalid schema",
        )
