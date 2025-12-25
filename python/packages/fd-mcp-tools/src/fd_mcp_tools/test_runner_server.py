"""Test Runner MCP Server - Provides test execution as MCP tools.

Tools provided:
- run_pytest: Run Python tests with pytest
- run_jest: Run JavaScript tests with jest
- run_cargo_test: Run Rust tests with cargo
- run_generic: Run any test command
- check_lint: Run linting checks
"""

import asyncio
import logging
import os
import shlex
import subprocess
from pathlib import Path
from typing import Any

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

logger = logging.getLogger(__name__)

# Base directory for test operations
WORKSPACE_DIR = Path(os.getenv("FD_WORKSPACE_DIR", "/tmp/fd-workspace"))

# Timeout for test commands (5 minutes)
TEST_TIMEOUT = int(os.getenv("FD_TEST_TIMEOUT", "300"))


def run_command(
    args: list[str],
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    timeout: int = TEST_TIMEOUT,
) -> tuple[bool, str, str]:
    """Run a command and return (success, stdout, stderr)."""
    try:
        # Merge with current environment
        full_env = os.environ.copy()
        if env:
            full_env.update(env)

        result = subprocess.run(
            args,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=full_env,
        )
        return (
            result.returncode == 0,
            result.stdout,
            result.stderr,
        )
    except subprocess.TimeoutExpired:
        return False, "", f"Command timed out after {timeout}s"
    except FileNotFoundError:
        return False, "", f"Command not found: {args[0]}"
    except Exception as e:
        return False, "", f"Command error: {e}"


def get_repo_path(repo_name: str) -> Path:
    """Get the local path for a repository."""
    safe_name = repo_name.replace("/", "_").replace("..", "").replace("\\", "")
    return WORKSPACE_DIR / safe_name


# Tool definitions
TOOLS = [
    Tool(
        name="run_pytest",
        description="Run Python tests with pytest",
        inputSchema={
            "type": "object",
            "properties": {
                "repo": {
                    "type": "string",
                    "description": "Repository name/path in workspace",
                },
                "path": {
                    "type": "string",
                    "description": "Test path (file or directory)",
                },
                "markers": {
                    "type": "string",
                    "description": "Pytest markers to filter (-m)",
                },
                "keyword": {
                    "type": "string",
                    "description": "Keyword expression to filter (-k)",
                },
                "verbose": {
                    "type": "boolean",
                    "description": "Verbose output (-v)",
                },
                "coverage": {
                    "type": "boolean",
                    "description": "Run with coverage (--cov)",
                },
                "extra_args": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Additional pytest arguments",
                },
            },
            "required": ["repo"],
        },
    ),
    Tool(
        name="run_jest",
        description="Run JavaScript/TypeScript tests with jest",
        inputSchema={
            "type": "object",
            "properties": {
                "repo": {
                    "type": "string",
                    "description": "Repository name/path in workspace",
                },
                "path": {
                    "type": "string",
                    "description": "Test path (file or directory)",
                },
                "pattern": {
                    "type": "string",
                    "description": "Test name pattern to filter",
                },
                "coverage": {
                    "type": "boolean",
                    "description": "Run with coverage",
                },
                "watch": {
                    "type": "boolean",
                    "description": "Run in watch mode (not recommended for CI)",
                },
                "extra_args": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Additional jest arguments",
                },
            },
            "required": ["repo"],
        },
    ),
    Tool(
        name="run_cargo_test",
        description="Run Rust tests with cargo",
        inputSchema={
            "type": "object",
            "properties": {
                "repo": {
                    "type": "string",
                    "description": "Repository name/path in workspace",
                },
                "package": {
                    "type": "string",
                    "description": "Package to test (-p)",
                },
                "test_name": {
                    "type": "string",
                    "description": "Test name filter",
                },
                "features": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Features to enable",
                },
                "all_features": {
                    "type": "boolean",
                    "description": "Enable all features",
                },
                "release": {
                    "type": "boolean",
                    "description": "Run in release mode",
                },
            },
            "required": ["repo"],
        },
    ),
    Tool(
        name="run_generic",
        description="Run any test command",
        inputSchema={
            "type": "object",
            "properties": {
                "repo": {
                    "type": "string",
                    "description": "Repository name/path in workspace",
                },
                "command": {
                    "type": "string",
                    "description": "Command to run (e.g., 'npm test')",
                },
                "timeout": {
                    "type": "integer",
                    "description": "Timeout in seconds (default: 300)",
                },
            },
            "required": ["repo", "command"],
        },
    ),
    Tool(
        name="check_lint",
        description="Run linting checks",
        inputSchema={
            "type": "object",
            "properties": {
                "repo": {
                    "type": "string",
                    "description": "Repository name/path in workspace",
                },
                "tool": {
                    "type": "string",
                    "enum": ["ruff", "eslint", "clippy", "auto"],
                    "description": "Linting tool to use (auto-detect if not specified)",
                },
                "fix": {
                    "type": "boolean",
                    "description": "Auto-fix issues if possible",
                },
                "path": {
                    "type": "string",
                    "description": "Path to lint (default: entire repo)",
                },
            },
            "required": ["repo"],
        },
    ),
    Tool(
        name="check_types",
        description="Run type checking",
        inputSchema={
            "type": "object",
            "properties": {
                "repo": {
                    "type": "string",
                    "description": "Repository name/path in workspace",
                },
                "tool": {
                    "type": "string",
                    "enum": ["pyright", "mypy", "tsc", "auto"],
                    "description": "Type checker to use (auto-detect if not specified)",
                },
                "path": {
                    "type": "string",
                    "description": "Path to check (default: entire repo)",
                },
            },
            "required": ["repo"],
        },
    ),
]


def detect_project_type(repo_path: Path) -> str:
    """Detect the primary project type."""
    if (repo_path / "pyproject.toml").exists() or (repo_path / "setup.py").exists():
        return "python"
    if (repo_path / "package.json").exists():
        return "javascript"
    if (repo_path / "Cargo.toml").exists():
        return "rust"
    if (repo_path / "go.mod").exists():
        return "go"
    return "unknown"


async def handle_tool_call(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    """Handle a tool call."""
    WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)

    if name == "run_pytest":
        repo_path = get_repo_path(arguments["repo"])

        args = ["pytest"]
        if arguments.get("path"):
            args.append(arguments["path"])
        if arguments.get("markers"):
            args.extend(["-m", arguments["markers"]])
        if arguments.get("keyword"):
            args.extend(["-k", arguments["keyword"]])
        if arguments.get("verbose", True):
            args.append("-v")
        if arguments.get("coverage"):
            args.append("--cov")
        if arguments.get("extra_args"):
            args.extend(arguments["extra_args"])

        args.extend(["--tb=short", "-q"])

        success, stdout, stderr = run_command(args, cwd=repo_path)

        output = f"{'PASSED' if success else 'FAILED'}\n\n{stdout}"
        if stderr and not success:
            output += f"\n\nErrors:\n{stderr}"

        return [TextContent(type="text", text=output)]

    elif name == "run_jest":
        repo_path = get_repo_path(arguments["repo"])

        args = ["npx", "jest"]
        if arguments.get("path"):
            args.append(arguments["path"])
        if arguments.get("pattern"):
            args.extend(["-t", arguments["pattern"]])
        if arguments.get("coverage"):
            args.append("--coverage")
        if arguments.get("watch"):
            args.append("--watch")
        args.append("--ci")
        if arguments.get("extra_args"):
            args.extend(arguments["extra_args"])

        success, stdout, stderr = run_command(args, cwd=repo_path)

        output = f"{'PASSED' if success else 'FAILED'}\n\n{stdout}"
        if stderr and not success:
            output += f"\n\nErrors:\n{stderr}"

        return [TextContent(type="text", text=output)]

    elif name == "run_cargo_test":
        repo_path = get_repo_path(arguments["repo"])

        args = ["cargo", "test"]
        if arguments.get("package"):
            args.extend(["-p", arguments["package"]])
        if arguments.get("features"):
            args.extend(["--features", ",".join(arguments["features"])])
        if arguments.get("all_features"):
            args.append("--all-features")
        if arguments.get("release"):
            args.append("--release")
        if arguments.get("test_name"):
            args.extend(["--", arguments["test_name"]])

        success, stdout, stderr = run_command(args, cwd=repo_path)

        output = f"{'PASSED' if success else 'FAILED'}\n\n{stdout}"
        if stderr:
            output += f"\n\n{stderr}"

        return [TextContent(type="text", text=output)]

    elif name == "run_generic":
        repo_path = get_repo_path(arguments["repo"])
        command = arguments["command"]
        timeout = arguments.get("timeout", TEST_TIMEOUT)

        # Use shlex.split for proper shell argument parsing (prevents command injection)
        args = shlex.split(command)

        success, stdout, stderr = run_command(args, cwd=repo_path, timeout=timeout)

        output = f"{'PASSED' if success else 'FAILED'}\n\n{stdout}"
        if stderr:
            output += f"\n\nStderr:\n{stderr}"

        return [TextContent(type="text", text=output)]

    elif name == "check_lint":
        repo_path = get_repo_path(arguments["repo"])
        tool = arguments.get("tool", "auto")
        fix = arguments.get("fix", False)
        path = arguments.get("path", ".")

        if tool == "auto":
            project_type = detect_project_type(repo_path)
            if project_type == "python":
                tool = "ruff"
            elif project_type == "javascript":
                tool = "eslint"
            elif project_type == "rust":
                tool = "clippy"
            else:
                return [TextContent(type="text", text="Could not detect project type for linting")]

        if tool == "ruff":
            args = ["ruff", "check"]
            if fix:
                args.append("--fix")
            args.append(path)
        elif tool == "eslint":
            args = ["npx", "eslint"]
            if fix:
                args.append("--fix")
            args.append(path)
        elif tool == "clippy":
            args = ["cargo", "clippy"]
            if fix:
                args.extend(["--fix", "--allow-dirty"])
            args.extend(["--", "-D", "warnings"])
        else:
            return [TextContent(type="text", text=f"Unknown lint tool: {tool}")]

        success, stdout, stderr = run_command(args, cwd=repo_path)

        if success:
            output = f"Lint PASSED\n{stdout or 'No issues found'}"
        else:
            output = f"Lint FAILED\n{stdout}\n{stderr}"

        return [TextContent(type="text", text=output)]

    elif name == "check_types":
        repo_path = get_repo_path(arguments["repo"])
        tool = arguments.get("tool", "auto")
        path = arguments.get("path", ".")

        if tool == "auto":
            project_type = detect_project_type(repo_path)
            if project_type == "python":
                tool = "pyright"
            elif project_type == "javascript":
                tool = "tsc"
            else:
                return [
                    TextContent(type="text", text="Could not detect project type for type checking")
                ]

        if tool == "pyright":
            args = ["pyright", path]
        elif tool == "mypy":
            args = ["mypy", path]
        elif tool == "tsc":
            args = ["npx", "tsc", "--noEmit"]
        else:
            return [TextContent(type="text", text=f"Unknown type checker: {tool}")]

        success, stdout, stderr = run_command(args, cwd=repo_path)

        if success:
            output = f"Type check PASSED\n{stdout or 'No type errors found'}"
        else:
            output = f"Type check FAILED\n{stdout}\n{stderr}"

        return [TextContent(type="text", text=output)]

    return [TextContent(type="text", text=f"Unknown tool: {name}")]


async def run_server():
    """Run the Test Runner MCP server."""
    server = Server("fd-mcp-test-runner")

    @server.list_tools()
    async def list_tools() -> list[Tool]:
        return TOOLS

    @server.call_tool()
    async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
        return await handle_tool_call(name, arguments)

    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


def main():
    """Entry point for the Test Runner MCP server."""
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_server())


if __name__ == "__main__":
    main()
