"""Guards for `scripts/check_live_stack_results.py`.

The gate exists because three suites reported "135 collected, 135 skipped, 0 run"
and nobody noticed. A gate for that failure mode which is itself untested would
be the same joke told twice, so each failure mode it claims to catch is asserted
here against a synthetic JUnit report.

The most important case is `test_a_stack_that_never_came_up_is_caught`: that is
the exact shape of the bug, and if only one test in this file survives, it should
be that one.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "scripts" / "check_live_stack_results.py"
DECLARATIONS = REPO / ".live-stack-known-failures.yml"


def junit(cases: list[tuple[str, str, str]], skipped: int = 0) -> str:
    """Build a JUnit report. Each case is (classname, name, outcome)."""
    body = []
    for classname, name, outcome in cases:
        inner = {
            "pass": "",
            "fail": '<failure message="boom">boom</failure>',
            "skip": '<skipped message="no stack"/>',
        }[outcome]
        body.append(f'<testcase classname="{classname}" name="{name}">{inner}</testcase>')
    total = len(cases)
    failures = sum(1 for _, _, o in cases if o == "fail")
    return (
        f'<testsuite name="pytest" tests="{total}" failures="{failures}" '
        f'errors="0" skipped="{skipped}">' + "".join(body) + "</testsuite>"
    )


def run(tmp_path: Path, xml: str, declarations: dict | None = None) -> subprocess.CompletedProcess:
    report = tmp_path / "report.xml"
    report.write_text(xml)
    decl_path = DECLARATIONS
    if declarations is not None:
        decl_path = tmp_path / "declarations.yml"
        decl_path.write_text(yaml.safe_dump(declarations))
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--junit", str(report), "--declarations", str(decl_path)],
        capture_output=True,
        text=True,
        cwd=REPO,
    )


BASE = {"floor": {"executed": 3}, "known_failures": []}


# ==========================================================================
# LSG-001: the cliff detector — the bug this whole gate exists for
# ==========================================================================
def test_a_stack_that_never_came_up_is_caught(tmp_path: Path) -> None:
    """135 collected, 135 skipped, 0 run must fail, not pass."""
    cases = [("tests.security.test_a.TestX", f"test_{i}", "skip") for i in range(5)]
    result = run(tmp_path, junit(cases, skipped=5), BASE)
    assert result.returncode == 1, result.stdout
    assert "below the floor" in result.stderr
    assert "executed=0" in result.stdout


def test_executing_above_the_floor_passes(tmp_path: Path) -> None:
    cases = [("tests.security.test_a.TestX", f"test_{i}", "pass") for i in range(4)]
    result = run(tmp_path, junit(cases), BASE)
    assert result.returncode == 0, result.stderr
    assert "OK" in result.stdout


def test_a_partial_collapse_is_still_caught(tmp_path: Path) -> None:
    """Two of five running is not "mostly fine" — it is the same failure, smaller."""
    cases = [("tests.security.test_a.TestX", f"test_{i}", "pass") for i in range(2)]
    cases += [("tests.security.test_a.TestX", f"test_s{i}", "skip") for i in range(3)]
    result = run(tmp_path, junit(cases, skipped=3), BASE)
    assert result.returncode == 1
    assert "below the floor" in result.stderr


# ==========================================================================
# LSG-002: undeclared failures — the difference from `|| true`
# ==========================================================================
def test_an_undeclared_failure_fails_the_build(tmp_path: Path) -> None:
    cases = [("tests.security.test_a.TestX", f"test_{i}", "pass") for i in range(3)]
    cases.append(("tests.security.test_a.TestX", "test_new_regression", "fail"))
    result = run(tmp_path, junit(cases), BASE)
    assert result.returncode == 1
    assert "Undeclared failure" in result.stderr
    assert "test_new_regression" in result.stderr


def test_a_declared_failure_is_tolerated(tmp_path: Path) -> None:
    cases = [("tests.security.test_a.TestX", f"test_{i}", "pass") for i in range(3)]
    cases.append(("tests.security.test_a.TestX", "test_known", "fail"))
    decl = {
        "floor": {"executed": 3},
        "known_failures": [
            {"test": "tests/security/test_a.py::TestX::test_known", "reason": "documented"}
        ],
    }
    result = run(tmp_path, junit(cases), decl)
    assert result.returncode == 0, result.stderr


# ==========================================================================
# LSG-003: the exemption list must shrink, not calcify
# ==========================================================================
def test_a_declaration_that_now_passes_is_rejected(tmp_path: Path) -> None:
    cases = [("tests.security.test_a.TestX", f"test_{i}", "pass") for i in range(3)]
    cases.append(("tests.security.test_a.TestX", "test_fixed", "pass"))
    decl = {
        "floor": {"executed": 3},
        "known_failures": [
            {"test": "tests/security/test_a.py::TestX::test_fixed", "reason": "was broken"}
        ],
    }
    result = run(tmp_path, junit(cases), decl)
    assert result.returncode == 1
    assert "Stale declaration" in result.stderr


def test_a_flaky_declaration_is_exempt_from_the_stale_check(tmp_path: Path) -> None:
    """A test that passes sometimes must not flip the build red when it passes."""
    cases = [("tests.security.test_a.TestX", f"test_{i}", "pass") for i in range(3)]
    cases.append(("tests.security.test_a.TestX", "test_racy", "pass"))
    decl = {
        "floor": {"executed": 3},
        "known_failures": [
            {
                "test": "tests/security/test_a.py::TestX::test_racy",
                "reason": "ordering dependent",
                "flaky": True,
            }
        ],
    }
    result = run(tmp_path, junit(cases), decl)
    assert result.returncode == 0, result.stderr


def test_a_flaky_declaration_still_may_not_fail_undeclared(tmp_path: Path) -> None:
    """`flaky` buys exemption from the stale check only, never from declaration."""
    cases = [("tests.security.test_a.TestX", f"test_{i}", "pass") for i in range(3)]
    cases.append(("tests.security.test_a.TestX", "test_other", "fail"))
    decl = {
        "floor": {"executed": 3},
        "known_failures": [
            {"test": "tests/security/test_a.py::TestX::test_racy", "reason": "r", "flaky": True}
        ],
    }
    result = run(tmp_path, junit(cases), decl)
    assert result.returncode == 1
    assert "test_other" in result.stderr


# ==========================================================================
# LSG-004: an exemption without a diagnosis is a silenced test
# ==========================================================================
def test_a_declaration_without_a_reason_is_rejected(tmp_path: Path) -> None:
    cases = [("tests.security.test_a.TestX", f"test_{i}", "pass") for i in range(3)]
    decl = {
        "floor": {"executed": 3},
        "known_failures": [{"test": "tests/security/test_a.py::TestX::test_known"}],
    }
    result = run(tmp_path, junit(cases), decl)
    assert result.returncode == 1
    assert "no `reason:`" in result.stderr


# ==========================================================================
# LSG-005: a missing report is the loudest "it never ran"
# ==========================================================================
def test_a_missing_report_fails(tmp_path: Path) -> None:
    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--junit",
            str(tmp_path / "nope.xml"),
            "--declarations",
            str(DECLARATIONS),
        ],
        capture_output=True,
        text=True,
        cwd=REPO,
    )
    assert result.returncode == 1
    assert "did not run" in result.stderr


# ==========================================================================
# LSG-006: node ids round-trip, or every declaration silently misses
# ==========================================================================
@pytest.mark.parametrize(
    ("classname", "name", "expected"),
    [
        (
            "tests.e2e.test_agent_runs.TestRunTimeout",
            "test_run_timeout",
            "tests/e2e/test_agent_runs.py::TestRunTimeout::test_run_timeout",
        ),
        (
            "tests.security.test_airlock.TestRcePatternsDetected",
            "test_rce_payload_is_flagged[pickle]",
            "tests/security/test_airlock.py::TestRcePatternsDetected::test_rce_payload_is_flagged[pickle]",
        ),
        # A module-level test has no class segment.
        (
            "tests.security.test_airlock",
            "test_module_level",
            "tests/security/test_airlock.py::test_module_level",
        ),
    ],
)
def test_junit_classnames_map_back_to_pytest_node_ids(
    classname: str, name: str, expected: str
) -> None:
    import importlib.util
    import xml.etree.ElementTree as ET

    # Loaded by path rather than by name: `scripts/` is not a package and is not
    # on sys.path, matching how tests/test_route_backing.py loads its checker.
    spec = importlib.util.spec_from_file_location("check_live_stack_results", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    case = ET.fromstring(f'<testcase classname="{classname}" name="{name}"/>')
    assert module.case_id(case) == expected


# ==========================================================================
# LSG-007: the committed declarations are well-formed and honest
# ==========================================================================
def test_committed_declarations_are_valid() -> None:
    doc = yaml.safe_load(DECLARATIONS.read_text())
    assert doc["floor"]["executed"] > 0, "a floor of zero gates nothing"
    for entry in doc["known_failures"]:
        assert entry.get("test"), entry
        assert entry.get("reason", "").strip(), f"{entry['test']} has no reason"
        assert "::" in entry["test"], f"{entry['test']} is not a pytest node id"
