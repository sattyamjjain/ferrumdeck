"""Guards scripts/check_route_backing.py.

A gate that cannot fail is the bug it exists to catch, so each failure mode has
a test that constructs it and asserts a non-zero exit. Lives at tests/ root so
CI's `tests/*.py` glob collects it (the 18-guards-never-collected fix).
"""

from __future__ import annotations

import importlib.util
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "check_route_backing.py"
APP_API = REPO / "nextjs" / "src" / "app" / "api"

STUB_TS = """import { NextResponse } from "next/server";
export async function GET() {
  return NextResponse.json(
    { error: "not_implemented", issue: "https://github.com/sattyamjjain/ferrumdeck/issues/7" },
    { status: 501 },
  );
}
"""

FIXTURE_TS = """import { NextResponse } from "next/server";
export async function GET() {
  return NextResponse.json({ items: [], total: 0 }, { status: 200 });
}
"""


def run(app_api: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--app-api", str(app_api)],
        capture_output=True,
        text=True,
        cwd=REPO,
    )


@pytest.fixture
def tree(tmp_path: Path) -> Path:
    dest = tmp_path / "api"
    shutil.copytree(APP_API, dest)
    return dest


def test_the_checker_exists_and_is_importable() -> None:
    spec = importlib.util.spec_from_file_location("crb", SCRIPT)
    assert spec and spec.loader
    spec.loader.exec_module(importlib.util.module_from_spec(spec))


def test_the_repo_as_committed_passes() -> None:
    """The gate must be green on main, or it is not a gate anyone can keep."""
    assert run(APP_API).returncode == 0


def test_a_route_with_no_backend_fails(tree: Path) -> None:
    """The dangerous class: answers 200 without asking anything."""
    (tree / "v1" / "fabricated").mkdir(parents=True)
    (tree / "v1" / "fabricated" / "route.ts").write_text(FIXTURE_TS)
    result = run(tree)
    assert result.returncode == 1
    assert "reaches no backend" in result.stderr


def test_a_declared_stub_that_became_a_fixture_fails(tree: Path) -> None:
    """An entry must not survive the route quietly starting to invent data."""
    (tree / "v1" / "evals" / "suites" / "[suiteId]" / "route.ts").write_text(FIXTURE_TS)
    result = run(tree)
    assert result.returncode == 1
    assert "no longer returns 501" in result.stderr


def test_a_stub_without_an_issue_reference_fails(tree: Path) -> None:
    """An untracked stub is a permanent one."""
    (tree / "v1" / "evals" / "regression-report" / "route.ts").write_text(
        FIXTURE_TS.replace(
            "{ items: [], total: 0 }, { status: 200 }",
            '{ error: "not_implemented" }, { status: 501 }',
        )
    )
    result = run(tree)
    assert result.returncode == 1
    assert "cites no issue" in result.stderr


def test_an_undeclared_stub_fails(tree: Path) -> None:
    """The stub surface stays countable rather than folklore."""
    (tree / "v1" / "newthing").mkdir(parents=True)
    (tree / "v1" / "newthing" / "route.ts").write_text(STUB_TS)
    result = run(tree)
    assert result.returncode == 1
    assert "not declared" in result.stderr


def test_a_stale_declaration_fails(tree: Path) -> None:
    """Stops the declaration file rotting into a permanent allowlist."""
    (tree / "v1" / "evals" / "suites" / "[suiteId]" / "route.ts").unlink()
    result = run(tree)
    assert result.returncode == 1
    assert "no longer exists" in result.stderr
