"""Schema validation scorer."""

from typing import Any

from fd_evals.scorers.base import BaseScorer
from fd_evals.task import EvalTask, ScorerResult


class SchemaScorer(BaseScorer):
    """Scorer that validates output against a JSON schema.

    This is a deterministic scorer that checks if the agent's output
    conforms to an expected schema structure.
    """

    def __init__(
        self,
        schema: dict[str, Any] | None = None,
        schema_key: str = "output_schema",
        weight: float = 1.0,
    ):
        """Initialize the schema scorer.

        Args:
            schema: Optional JSON schema to validate against.
            schema_key: Key in task.expected containing the schema.
            weight: Weight for composite scoring.
        """
        super().__init__(name="SchemaScorer", weight=weight)
        self.schema = schema
        self.schema_key = schema_key

    def score(
        self,
        task: EvalTask,
        actual_output: dict[str, Any],
        run_context: dict[str, Any],
    ) -> ScorerResult:
        """Validate output against schema.

        Args:
            task: Task with expected.output_schema or schema validation expectation.
            actual_output: The output to validate.
            run_context: Additional context.

        Returns:
            ScorerResult based on schema validation.
        """
        # Get schema from task or use provided one
        schema = self.schema or task.expected.get(self.schema_key)

        if not schema:
            return ScorerResult(
                scorer_name=self.name,
                passed=True,
                score=1.0,
                message="No schema validation required",
                details={"skipped": True},
            )

        try:
            # Try to use jsonschema if available
            import jsonschema
        except ImportError:
            # Fall back to basic type checking
            return self._basic_validation(actual_output, schema)

        try:
            jsonschema.validate(actual_output, schema)
            return ScorerResult(
                scorer_name=self.name,
                passed=True,
                score=1.0,
                message="Output matches expected schema",
                details={"schema": schema},
            )
        except jsonschema.ValidationError as e:
            return ScorerResult(
                scorer_name=self.name,
                passed=False,
                score=0.0,
                message=f"Schema validation failed: {e.message}",
                details={
                    "error": str(e.message),
                    "path": list(e.path),
                    "schema_path": list(e.schema_path),
                },
            )

    def _basic_validation(
        self,
        data: Any,
        schema: dict[str, Any],
    ) -> ScorerResult:
        """Basic schema validation without jsonschema library."""
        errors: list[str] = []

        def validate_type(value: Any, expected_type: str, path: str) -> bool:
            type_map = {
                "string": str,
                "integer": int,
                "number": (int, float),
                "boolean": bool,
                "array": list,
                "object": dict,
                "null": type(None),
            }

            expected = type_map.get(expected_type)
            if expected and not isinstance(value, expected):
                errors.append(f"{path}: expected {expected_type}, got {type(value).__name__}")
                return False
            return True

        def validate_object(obj: Any, obj_schema: dict[str, Any], path: str = "") -> None:
            obj_type = obj_schema.get("type")
            if obj_type:
                if not validate_type(obj, obj_type, path):
                    return

            if obj_type == "object" and isinstance(obj, dict):
                # Check required properties
                required = obj_schema.get("required", [])
                for prop in required:
                    if prop not in obj:
                        errors.append(f"{path}.{prop}: required property missing")

                # Validate properties
                properties = obj_schema.get("properties", {})
                for prop, prop_schema in properties.items():
                    if prop in obj:
                        validate_object(obj[prop], prop_schema, f"{path}.{prop}")

            elif obj_type == "array" and isinstance(obj, list):
                items_schema = obj_schema.get("items")
                if items_schema:
                    for i, item in enumerate(obj):
                        validate_object(item, items_schema, f"{path}[{i}]")

        validate_object(data, schema, "root")

        if errors:
            return ScorerResult(
                scorer_name=self.name,
                passed=False,
                score=max(0.0, 1.0 - (len(errors) * 0.2)),
                message=f"Schema validation failed: {len(errors)} errors",
                details={"errors": errors[:10]},
            )

        return ScorerResult(
            scorer_name=self.name,
            passed=True,
            score=1.0,
            message="Output matches expected schema",
            details={"validation_method": "basic"},
        )


class OutputStructureScorer(BaseScorer):
    """Scorer that checks for required keys in output."""

    def __init__(
        self,
        required_keys: list[str] | None = None,
        weight: float = 1.0,
    ):
        super().__init__(name="OutputStructureScorer", weight=weight)
        self.required_keys = required_keys or []

    def score(
        self,
        task: EvalTask,
        actual_output: dict[str, Any],
        run_context: dict[str, Any],
    ) -> ScorerResult:
        """Check for required keys in output.

        Args:
            task: Task with expected.required_output_keys.
            actual_output: The output to check.
            run_context: Additional context.

        Returns:
            ScorerResult based on key presence.
        """
        required = self.required_keys or task.expected.get("required_output_keys", [])

        if not required:
            return ScorerResult(
                scorer_name=self.name,
                passed=True,
                score=1.0,
                message="No required output keys specified",
                details={"skipped": True},
            )

        present = [k for k in required if k in actual_output]
        missing = [k for k in required if k not in actual_output]

        score = len(present) / len(required) if required else 1.0
        passed = len(missing) == 0

        if passed:
            message = f"All {len(required)} required keys present"
        else:
            message = f"Missing {len(missing)} required keys: {missing}"

        return ScorerResult(
            scorer_name=self.name,
            passed=passed,
            score=score,
            message=message,
            details={
                "required": required,
                "present": present,
                "missing": missing,
            },
        )
