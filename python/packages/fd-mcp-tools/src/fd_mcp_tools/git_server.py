"""Git MCP Server - Provides git operations as MCP tools.

Tools provided:
- git_clone: Clone a repository
- git_status: Get repository status
- git_add: Stage files
- git_commit: Create a commit
- git_push: Push to remote
- git_diff: Show changes
- git_checkout: Switch branches
- git_branch: List or create branches
"""

import asyncio
import logging
import os
import re
import subprocess
from pathlib import Path
from typing import Any

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

logger = logging.getLogger(__name__)

# Base directory for git operations (sandboxed)
WORKSPACE_DIR = Path(os.getenv("FD_WORKSPACE_DIR", "/tmp/fd-workspace"))


def run_git_command(args: list[str], cwd: Path | None = None) -> tuple[bool, str]:
    """Run a git command and return (success, output)."""
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=60,
        )
        output = result.stdout + result.stderr
        return result.returncode == 0, output.strip()
    except subprocess.TimeoutExpired:
        return False, "Git command timed out"
    except Exception as e:
        return False, f"Git error: {e}"


def get_repo_path(repo_name: str) -> Path:
    """Get the local path for a repository.

    Raises:
        ValueError: If the repository name would escape the workspace directory.
    """
    # Sanitize repo name: only allow alphanumeric, underscore, dash, and dot
    safe_name = re.sub(r'[^\w\-.]', '_', repo_name)

    # Resolve the full path and ensure it stays within WORKSPACE_DIR
    repo_path = (WORKSPACE_DIR / safe_name).resolve()

    # Security check: ensure the resolved path is within WORKSPACE_DIR
    if not repo_path.is_relative_to(WORKSPACE_DIR.resolve()):
        raise ValueError(f"Invalid repository name: {repo_name}")

    return repo_path


# Tool definitions
TOOLS = [
    Tool(
        name="git_clone",
        description="Clone a git repository to the workspace",
        inputSchema={
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "Repository URL (HTTPS or SSH)",
                },
                "branch": {
                    "type": "string",
                    "description": "Branch to checkout (default: default branch)",
                },
                "name": {
                    "type": "string",
                    "description": "Local directory name (default: derived from URL)",
                },
            },
            "required": ["url"],
        },
    ),
    Tool(
        name="git_status",
        description="Get the status of a repository",
        inputSchema={
            "type": "object",
            "properties": {
                "repo": {
                    "type": "string",
                    "description": "Repository name/path in workspace",
                },
            },
            "required": ["repo"],
        },
    ),
    Tool(
        name="git_add",
        description="Stage files for commit",
        inputSchema={
            "type": "object",
            "properties": {
                "repo": {
                    "type": "string",
                    "description": "Repository name/path in workspace",
                },
                "files": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Files to stage (use '.' for all)",
                },
            },
            "required": ["repo", "files"],
        },
    ),
    Tool(
        name="git_commit",
        description="Create a commit with staged changes",
        inputSchema={
            "type": "object",
            "properties": {
                "repo": {
                    "type": "string",
                    "description": "Repository name/path in workspace",
                },
                "message": {
                    "type": "string",
                    "description": "Commit message",
                },
                "author": {
                    "type": "string",
                    "description": "Author (format: 'Name <email>')",
                },
            },
            "required": ["repo", "message"],
        },
    ),
    Tool(
        name="git_push",
        description="Push commits to remote",
        inputSchema={
            "type": "object",
            "properties": {
                "repo": {
                    "type": "string",
                    "description": "Repository name/path in workspace",
                },
                "remote": {
                    "type": "string",
                    "description": "Remote name (default: origin)",
                },
                "branch": {
                    "type": "string",
                    "description": "Branch to push (default: current branch)",
                },
                "set_upstream": {
                    "type": "boolean",
                    "description": "Set upstream tracking (default: false)",
                },
            },
            "required": ["repo"],
        },
    ),
    Tool(
        name="git_diff",
        description="Show changes in the repository",
        inputSchema={
            "type": "object",
            "properties": {
                "repo": {
                    "type": "string",
                    "description": "Repository name/path in workspace",
                },
                "staged": {
                    "type": "boolean",
                    "description": "Show staged changes (default: false)",
                },
                "file": {
                    "type": "string",
                    "description": "Specific file to diff (optional)",
                },
            },
            "required": ["repo"],
        },
    ),
    Tool(
        name="git_checkout",
        description="Switch to a branch or create a new one",
        inputSchema={
            "type": "object",
            "properties": {
                "repo": {
                    "type": "string",
                    "description": "Repository name/path in workspace",
                },
                "branch": {
                    "type": "string",
                    "description": "Branch name to checkout",
                },
                "create": {
                    "type": "boolean",
                    "description": "Create the branch if it doesn't exist",
                },
            },
            "required": ["repo", "branch"],
        },
    ),
    Tool(
        name="git_branch",
        description="List or create branches",
        inputSchema={
            "type": "object",
            "properties": {
                "repo": {
                    "type": "string",
                    "description": "Repository name/path in workspace",
                },
                "name": {
                    "type": "string",
                    "description": "New branch name (optional, lists if not provided)",
                },
                "delete": {
                    "type": "boolean",
                    "description": "Delete the branch instead of creating",
                },
            },
            "required": ["repo"],
        },
    ),
    Tool(
        name="git_log",
        description="Show commit history",
        inputSchema={
            "type": "object",
            "properties": {
                "repo": {
                    "type": "string",
                    "description": "Repository name/path in workspace",
                },
                "count": {
                    "type": "integer",
                    "description": "Number of commits to show (default: 10)",
                },
                "oneline": {
                    "type": "boolean",
                    "description": "One line per commit (default: true)",
                },
            },
            "required": ["repo"],
        },
    ),
]


async def handle_tool_call(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    """Handle a tool call."""
    WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)

    if name == "git_clone":
        url = arguments["url"]
        branch = arguments.get("branch")
        local_name = arguments.get("name")

        if not local_name:
            # Derive from URL
            local_name = url.rstrip("/").split("/")[-1]
            if local_name.endswith(".git"):
                local_name = local_name[:-4]

        repo_path = get_repo_path(local_name)

        if repo_path.exists():
            return [TextContent(type="text", text=f"Repository already exists at {repo_path}")]

        args = ["clone"]
        if branch:
            args.extend(["--branch", branch])
        args.extend([url, str(repo_path)])

        success, output = run_git_command(args)
        if success:
            return [TextContent(type="text", text=f"Cloned {url} to {repo_path}\n{output}")]
        return [TextContent(type="text", text=f"Clone failed: {output}")]

    elif name == "git_status":
        repo_path = get_repo_path(arguments["repo"])
        success, output = run_git_command(["status", "--short"], cwd=repo_path)
        if success:
            return [TextContent(type="text", text=output or "Working tree clean")]
        return [TextContent(type="text", text=f"Error: {output}")]

    elif name == "git_add":
        repo_path = get_repo_path(arguments["repo"])
        files = arguments["files"]
        success, output = run_git_command(["add", *files], cwd=repo_path)
        if success:
            return [TextContent(type="text", text=f"Staged files: {files}")]
        return [TextContent(type="text", text=f"Add failed: {output}")]

    elif name == "git_commit":
        repo_path = get_repo_path(arguments["repo"])
        message = arguments["message"]
        author = arguments.get("author")

        args = ["commit", "-m", message]
        if author:
            args.extend(["--author", author])

        success, output = run_git_command(args, cwd=repo_path)
        if success:
            return [TextContent(type="text", text=f"Committed: {output}")]
        return [TextContent(type="text", text=f"Commit failed: {output}")]

    elif name == "git_push":
        repo_path = get_repo_path(arguments["repo"])
        remote = arguments.get("remote", "origin")
        branch = arguments.get("branch")
        set_upstream = arguments.get("set_upstream", False)

        args = ["push"]
        if set_upstream:
            args.append("-u")
        args.append(remote)
        if branch:
            args.append(branch)

        success, output = run_git_command(args, cwd=repo_path)
        if success:
            return [TextContent(type="text", text=f"Pushed to {remote}: {output}")]
        return [TextContent(type="text", text=f"Push failed: {output}")]

    elif name == "git_diff":
        repo_path = get_repo_path(arguments["repo"])
        staged = arguments.get("staged", False)
        file = arguments.get("file")

        args = ["diff"]
        if staged:
            args.append("--staged")
        if file:
            args.append(file)

        success, output = run_git_command(args, cwd=repo_path)
        if success:
            return [TextContent(type="text", text=output or "No changes")]
        return [TextContent(type="text", text=f"Diff failed: {output}")]

    elif name == "git_checkout":
        repo_path = get_repo_path(arguments["repo"])
        branch = arguments["branch"]
        create = arguments.get("create", False)

        args = ["checkout"]
        if create:
            args.append("-b")
        args.append(branch)

        success, output = run_git_command(args, cwd=repo_path)
        if success:
            return [TextContent(type="text", text=f"Switched to branch: {branch}")]
        return [TextContent(type="text", text=f"Checkout failed: {output}")]

    elif name == "git_branch":
        repo_path = get_repo_path(arguments["repo"])
        name_arg = arguments.get("name")
        delete = arguments.get("delete", False)

        if name_arg:
            args = ["branch"]
            if delete:
                args.append("-d")
            args.append(name_arg)
        else:
            args = ["branch", "-a"]

        success, output = run_git_command(args, cwd=repo_path)
        if success:
            return [TextContent(type="text", text=output or "No branches")]
        return [TextContent(type="text", text=f"Branch command failed: {output}")]

    elif name == "git_log":
        repo_path = get_repo_path(arguments["repo"])
        count = arguments.get("count", 10)
        oneline = arguments.get("oneline", True)

        args = ["log", f"-{count}"]
        if oneline:
            args.append("--oneline")

        success, output = run_git_command(args, cwd=repo_path)
        if success:
            return [TextContent(type="text", text=output or "No commits")]
        return [TextContent(type="text", text=f"Log failed: {output}")]

    return [TextContent(type="text", text=f"Unknown tool: {name}")]


async def run_server():
    """Run the Git MCP server."""
    server = Server("fd-mcp-git")

    @server.list_tools()
    async def list_tools() -> list[Tool]:
        return TOOLS

    @server.call_tool()
    async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
        return await handle_tool_call(name, arguments)

    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


def main():
    """Entry point for the Git MCP server."""
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_server())


if __name__ == "__main__":
    main()
