"""Scoring functions for evaluations."""

from abc import ABC, abstractmethod
from typing import Any

import jsonschema
from jsonschema import Draft202012Validator, ValidationError
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
        if (isinstance(actual, str) and isinstance(expected, str)) or isinstance(
            actual, (list, set)
        ):
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
        # Validate the schema itself is valid
        Draft202012Validator.check_schema(schema)
        self._validator = Draft202012Validator(schema)

    def score(self, actual: Any, expected: Any) -> ScoreResult:
        """Validate actual output against the JSON schema.

        Args:
            actual: The data to validate against the schema.
            expected: Ignored for schema validation (schema is set in __init__).

        Returns:
            ScoreResult with pass/fail and validation error details if any.
        """
        _ = expected  # unused - schema is set in __init__

        try:
            self._validator.validate(actual)
            return ScoreResult(
                score=1.0,
                passed=True,
                reason="valid schema",
            )
        except ValidationError as e:
            # Collect all validation errors for better diagnostics
            errors = list(self._validator.iter_errors(actual))
            error_messages = [f"{err.json_path}: {err.message}" for err in errors[:5]]

            return ScoreResult(
                score=0.0,
                passed=False,
                reason=f"schema validation failed: {e.message}",
                metadata={"validation_errors": error_messages},
            )
