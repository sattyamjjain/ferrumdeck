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
import yaml

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "check_route_backing.py"
APP_API = REPO / "nextjs" / "src" / "app" / "api"
DECLARATIONS = REPO / ".route-backing.yml"


def a_declared_stub() -> str:
    """Any route currently declared as a stub, read from the declaration file.

    Deliberately not hardcoded. This test used to name
    `v1/evals/suites/[suiteId]/route.ts` directly, and when that route was
    implemented in 0.8.13 the test failed -- not because the gate broke, but
    because the fixture it built no longer described a stub. Closing a stub must
    not break the guard that stops stubs from rotting; deriving the target keeps
    the two independent.
    """
    doc = yaml.safe_load(DECLARATIONS.read_text()) or {}
    stubs = doc.get("declared_stubs") or []
    if not stubs:
        pytest.skip(
            "no declared stubs remain, so 'a stub became a fixture' is not a "
            "reachable state -- which is the good outcome, not a broken test"
        )
    return stubs[0]["route"]

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
    route = a_declared_stub()
    target = tree / route
    assert target.exists(), (
        f"{route} is declared in {DECLARATIONS.name} but does not exist on disk"
    )
    target.write_text(FIXTURE_TS)
    result = run(tree)
    assert result.returncode == 1
    assert "no longer returns 501" in result.stderr


def test_a_stub_without_an_issue_reference_fails(tree: Path) -> None:
    """An untracked stub is a permanent one."""
    route = a_declared_stub()
    (tree / route).write_text(
        FIXTURE_TS.replace(
            "{ items: [], total: 0 }, { status: 200 }",
            '{ error: "not_implemented" }, { status: 501 }',
        )
    )
    result = run(tree)
    assert result.returncode == 1
    assert "cites no issue" in result.stderr


# ---------------------------------------------------------------------------
# degraded_fallback: reaches a backend AND degrades to 501 when it is down.
#
# Added with the eval store (#46). Before it, "we never built this" and "the
# gateway is down right now" were the same 501 to the checker, so a genuinely
# backed route had to be declared a stub -- a false statement in the other
# direction. These pin the difference the category exists to express.
# ---------------------------------------------------------------------------


def a_degraded_route() -> str:
    """A route currently declared as a degraded fallback."""
    doc = yaml.safe_load(DECLARATIONS.read_text()) or {}
    entries = doc.get("degraded_fallback") or []
    if not entries:
        pytest.skip("no degraded_fallback routes are declared")
    return entries[0]["route"]


def test_a_degraded_fallback_that_lost_its_backend_fails(tree: Path) -> None:
    """A stub wearing a better name must not pass as backed.

    The whole risk of adding this category is that it becomes a laundering
    route: declare a stub as `degraded_fallback` and the 501 stops being
    counted. So the checker requires a real backend call, and this proves it.
    """
    route = a_degraded_route()
    (tree / route).write_text(STUB_TS)  # 501 + issue, but no fetch(
    result = run(tree)
    assert result.returncode == 1
    assert "reaches no backend" in result.stderr


def test_a_degraded_fallback_that_lost_its_501_fails(tree: Path) -> None:
    """An exemption nothing needs is how this file rots into an allowlist."""
    route = a_degraded_route()
    (tree / route).write_text(
        """import { NextResponse } from "next/server";
export async function GET() {
  const r = await fetch("http://gateway/v1/thing");
  return NextResponse.json(await r.json());
}
"""
    )
    result = run(tree)
    assert result.returncode == 1
    assert "no 501 path left" in result.stderr


def test_a_stale_degraded_declaration_fails(tree: Path) -> None:
    """A declaration for a route that no longer exists must be removed."""
    route = a_degraded_route()
    (tree / route).unlink()
    result = run(tree)
    assert result.returncode == 1
    assert "no longer exists" in result.stderr


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


def test_a_gateway_501_without_an_issue_link_fails(tmp_path: Path) -> None:
    """The gateway plane is held to the same rule as the BFF."""
    handlers = tmp_path / "handlers"
    handlers.mkdir()
    (handlers / "thing.rs").write_text(
        "fn no_store() -> Response {\n"
        "    (\n"
        "        StatusCode::NOT_IMPLEMENTED,\n"
        '        Json(json!({ "error": { "code": "NOPE" } })),\n'
        "    ).into_response()\n"
        "}\n"
    )
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--gateway", str(handlers)],
        capture_output=True,
        text=True,
        cwd=REPO,
    )
    assert result.returncode == 1
    assert "without an issue link" in result.stderr


def test_the_real_gateway_501_is_issue_linked() -> None:
    """handlers/evals.rs carries #7 in its NO_EVAL_STORE body; keep it that way."""
    result = run(APP_API)
    assert result.returncode == 0
    assert "gateway 501 site(s), all issue-linked" in result.stdout
