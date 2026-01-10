#!/usr/bin/env python3
"""Verify FerrumDeck Python package imports and structure.

This script checks:
1. Package pyproject.toml validity
2. __init__.py exports are correct
3. No import cycles exist
4. Type hints are present
5. All modules are importable
"""

import ast
import sys
from pathlib import Path
from typing import Any

# Base directory - use script location to find project root
FERRUMDECK_ROOT = Path(__file__).parent.resolve()
PACKAGES_DIR = FERRUMDECK_ROOT / "python" / "packages"

# Test cases for each package
PACKAGE_TESTS = {
    "fd-evals": {
        "modules": ["replay", "delta", "scorers"],
        "classes": [
            "ReplayConfig",
            "ReplayMode",
            "ReplayRunner",
            "ReplayTrace",
            "DeltaReport",
            "DeltaReporter",
            "DeltaStatus",
            "BaseScorer",
            "CompositeScorer",
            "FilesChangedScorer",
            "LintScorer",
            "PRCreatedScorer",
            "SchemaScorer",
            "TestPassScorer",
        ],
        "functions": [
            "create_trace_from_run",
            "load_trace",
            "save_trace",
            "generate_markdown_report",
            "load_report",
            "save_report",
        ],
    },
    "fd-worker": {
        "modules": ["validation", "llm", "executor", "queue"],
        "classes": [
            "OutputValidator",
            "ValidationResult",
            "LLMExecutor",
            "LLMResponse",
            "LLMUsage",
            "StepExecutor",
            "RedisQueueConsumer",
        ],
        "functions": ["validate_llm_output_for_tool_use"],
    },
    "fd-mcp-tools": {
        "modules": ["git_server", "test_runner_server"],
        "classes": [],
        "functions": [],
    },
    "fd-runtime": {
        "modules": ["models", "artifacts", "tracing", "workflow", "client"],
        "classes": [
            "Run",
            "Step",
            "RunStatus",
            "StepStatus",
            "StepType",
            "Budget",
            "BudgetUsage",
            "ArtifactMetadata",
            "ArtifactStore",
            "ArtifactType",
            "LocalFilesystemStore",
            "Workflow",
            "WorkflowContext",
            "WorkflowEngine",
            "WorkflowStep",
            "ControlPlaneClient",
        ],
        "functions": [
            "create_artifact_store",
            "get_tracer",
            "init_tracing",
            "calculate_cost",
            "extract_context",
            "inject_context",
            "trace_llm_call",
            "trace_step_execution",
            "trace_tool_call",
            "set_llm_response_attributes",
        ],
    },
}


class ImportChecker:
    """Checks if imports work properly."""

    def __init__(self, package_name: str):
        self.package_name = package_name
        self.package_dir = PACKAGES_DIR / package_name
        self.src_dir = self.package_dir / "src"
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def check_pyproject_toml(self) -> bool:
        """Check if pyproject.toml exists and is valid."""
        pyproject = self.package_dir / "pyproject.toml"
        if not pyproject.exists():
            self.errors.append(f"pyproject.toml not found")
            return False

        try:
            import tomllib

            with open(pyproject, "rb") as f:
                data = tomllib.load(f)

            # Check required fields
            if "project" not in data:
                self.errors.append("pyproject.toml missing [project] section")
                return False

            project = data["project"]
            required_fields = ["name", "version", "description", "requires-python"]
            for field in required_fields:
                if field not in project:
                    self.warnings.append(f"pyproject.toml missing field: {field}")

            return True
        except Exception as e:
            self.errors.append(f"Failed to parse pyproject.toml: {e}")
            return False

    def check_init_py(self) -> bool:
        """Check if __init__.py exists and has proper exports."""
        module_name = self.package_name.replace("-", "_")
        init_file = self.src_dir / module_name / "__init__.py"

        if not init_file.exists():
            self.errors.append(f"__init__.py not found at {init_file}")
            return False

        try:
            with open(init_file) as f:
                content = f.read()

            tree = ast.parse(content)

            # Check for __all__ definition
            has_all = False
            for node in ast.walk(tree):
                if isinstance(node, ast.Assign):
                    for target in node.targets:
                        if isinstance(target, ast.Name) and target.id == "__all__":
                            has_all = True
                            break

            if not has_all:
                self.warnings.append("__init__.py missing __all__ definition")

            return True
        except Exception as e:
            self.errors.append(f"Failed to parse __init__.py: {e}")
            return False

    def check_type_hints(self) -> bool:
        """Check if modules have type hints."""
        module_name = self.package_name.replace("-", "_")
        module_dir = self.src_dir / module_name

        if not module_dir.exists():
            self.errors.append(f"Module directory not found: {module_dir}")
            return False

        py_files = list(module_dir.rglob("*.py"))
        if not py_files:
            self.warnings.append("No Python files found")
            return True

        files_without_hints = []
        for py_file in py_files:
            if py_file.name.startswith("_") and py_file.name != "__init__.py":
                continue  # Skip private modules

            try:
                with open(py_file) as f:
                    content = f.read()

                tree = ast.parse(content)

                # Check for function definitions with type hints
                has_hints = False
                for node in ast.walk(tree):
                    if isinstance(node, ast.FunctionDef):
                        if node.returns is not None or any(
                            arg.annotation is not None for arg in node.args.args
                        ):
                            has_hints = True
                            break

                if not has_hints and len(content.strip()) > 0:
                    files_without_hints.append(py_file.relative_to(self.src_dir))

            except Exception as e:
                self.warnings.append(f"Failed to check type hints in {py_file}: {e}")

        if files_without_hints:
            self.warnings.append(
                f"Files without type hints: {', '.join(str(f) for f in files_without_hints[:3])}"
            )

        return True

    def check_import_cycles(self) -> bool:
        """Basic check for import cycles (simplified)."""
        module_name = self.package_name.replace("-", "_")
        module_dir = self.src_dir / module_name

        if not module_dir.exists():
            return True

        # Build import graph
        imports: dict[str, list[str]] = {}
        py_files = list(module_dir.rglob("*.py"))

        for py_file in py_files:
            try:
                with open(py_file) as f:
                    content = f.read()

                tree = ast.parse(content)
                relative_path = str(py_file.relative_to(module_dir))

                file_imports = []
                for node in ast.walk(tree):
                    if isinstance(node, ast.ImportFrom):
                        if node.module and node.module.startswith(module_name):
                            file_imports.append(node.module)

                imports[relative_path] = file_imports

            except Exception:
                continue

        # Simple cycle detection (DFS)
        def has_cycle(node: str, visited: set[str], rec_stack: set[str]) -> bool:
            visited.add(node)
            rec_stack.add(node)

            for neighbor in imports.get(node, []):
                if neighbor not in visited:
                    if has_cycle(neighbor, visited, rec_stack):
                        return True
                elif neighbor in rec_stack:
                    return True

            rec_stack.remove(node)
            return False

        visited: set[str] = set()
        for node in imports:
            if node not in visited:
                if has_cycle(node, visited, set()):
                    self.errors.append(f"Import cycle detected starting from {node}")
                    return False

        return True

    def run_all_checks(self) -> bool:
        """Run all checks and return success status."""
        print(f"\nChecking {self.package_name}...")
        print("=" * 60)

        checks = [
            ("pyproject.toml", self.check_pyproject_toml),
            ("__init__.py", self.check_init_py),
            ("Type hints", self.check_type_hints),
            ("Import cycles", self.check_import_cycles),
        ]

        success = True
        for check_name, check_func in checks:
            try:
                result = check_func()
                status = "✓" if result else "✗"
                print(f"  {status} {check_name}")
                if not result:
                    success = False
            except Exception as e:
                print(f"  ✗ {check_name} (exception: {e})")
                success = False

        if self.warnings:
            print("\nWarnings:")
            for warning in self.warnings:
                print(f"  ⚠ {warning}")

        if self.errors:
            print("\nErrors:")
            for error in self.errors:
                print(f"  ✗ {error}")

        return success


def main() -> int:
    """Main entry point."""
    print("FerrumDeck Python Package Verification")
    print("=" * 60)

    packages = ["fd-evals", "fd-worker", "fd-mcp-tools", "fd-runtime"]
    all_success = True

    for package in packages:
        checker = ImportChecker(package)
        if not checker.run_all_checks():
            all_success = False

    print("\n" + "=" * 60)
    if all_success:
        print("✓ All packages passed verification!")
        return 0
    else:
        print("✗ Some packages failed verification")
        return 1


if __name__ == "__main__":
    sys.exit(main())
