# fd-mcp-tools

FerrumDeck MCP Tool Servers for Git operations and test running.

## Overview

This package provides MCP (Model Context Protocol) servers that expose Git and test execution capabilities to FerrumDeck agents.

## Servers

### Git Server (`fd-mcp-git`)

Provides Git operations via MCP tools:
- `git_status` - Get repository status
- `git_diff` - Show file differences
- `git_log` - View commit history
- `git_commit` - Create commits
- `git_branch` - Manage branches

### Test Runner Server (`fd-mcp-test-runner`)

Provides test execution via MCP tools:
- `run_tests` - Execute test suite
- `list_tests` - Discover available tests
- `get_coverage` - Retrieve coverage reports

## Usage

```bash
# Start Git MCP server
fd-mcp-git

# Start Test Runner MCP server
fd-mcp-test-runner
```

## Configuration

Servers communicate via stdio and are designed to be spawned by the FerrumDeck worker's MCP router.

## Note

For GitHub API operations (PRs, issues, etc.), use the official GitHub MCP server:
- https://github.com/github/github-mcp-server
- Install via: `npx -y @anthropic-ai/github-mcp-server`
