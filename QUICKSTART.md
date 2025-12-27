# FerrumDeck Quick Start Guide

Get FerrumDeck running locally in 5 minutes.

## Prerequisites

- **Docker** - [Install Docker](https://docs.docker.com/get-docker/)
- **Rust 1.80+** - `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **Python 3.12+** - Check with `python3 --version`
- **uv** - `curl -LsSf https://astral.sh/uv/install.sh | sh`

## Quick Start

### 1. Clone and Setup

```bash
cd ferrumdeck

# Copy environment template
cp .env.example .env

# Edit .env and add your API keys:
# - ANTHROPIC_API_KEY=sk-ant-xxx (required for agent to work)
# - GITHUB_TOKEN=ghp_xxx (required for GitHub operations)
```

### 2. Start Everything

```bash
# Option A: Use the startup script
./scripts/start-dev.sh

# Option B: Manual startup
make install      # Install dependencies
make dev-up       # Start Docker services
```

### 3. Start the Dashboard

```bash
# In a new terminal
make run-dashboard
```

Open **http://localhost:8000** in your browser.

## Using the Dashboard

### Create a Run

1. Click **"+ New Run"** button
2. Select agent: **"Safe PR Agent"**
3. Enter a task, e.g., "Read the README from github/github-mcp-server repo"
4. Click **"Create Run"**

### Monitor Execution

- Watch the run status change: `created` → `queued` → `running` → `completed`
- Click on a run to see its steps
- View LLM calls and tool executions in the timeline

### Handle Approvals

When the agent wants to do something sensitive (like creating a PR):
1. The run status changes to `waiting_approval`
2. An approval request appears in the right sidebar
3. Click **"Approve"** or **"Reject"**

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Your Browser                            │
│                     (Dashboard UI :8000)                        │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP
┌───────────────────────────▼─────────────────────────────────────┐
│                        Gateway :8080                            │
│                   (Rust Control Plane)                          │
│  - API endpoints    - Policy enforcement    - Run orchestration │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Redis Queue
┌───────────────────────────▼─────────────────────────────────────┐
│                         Worker                                  │
│                   (Python Data Plane)                           │
│  - LLM calls (Claude)    - Tool execution    - MCP Router       │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Docker
┌───────────────────────────▼─────────────────────────────────────┐
│                    GitHub MCP Server                            │
│             (ghcr.io/github/github-mcp-server)                  │
│  - get_file_contents    - create_pull_request    - search_code  │
└─────────────────────────────────────────────────────────────────┘
```

## Available Tools

The agent can use these GitHub tools:

### Always Allowed (Read Operations)
| Tool | Description |
|------|-------------|
| `get_file_contents` | Read files from repositories |
| `search_repositories` | Search GitHub repos |
| `search_code` | Search code across repos |
| `list_commits` | View commit history |
| `get_pull_request` | Get PR details |
| `list_issues` | List repository issues |

### Require Approval (Write Operations)
| Tool | Description |
|------|-------------|
| `create_or_update_file` | Create/modify files |
| `create_pull_request` | Create new PRs |
| `create_issue` | Create new issues |
| `create_branch` | Create branches |
| `push_files` | Push multiple files |

### Denied (Never Allowed)
| Tool | Description |
|------|-------------|
| `delete_file` | Delete files |
| `merge_pull_request` | Merge PRs |
| `close_issue` | Close issues |

## API Quick Reference

### Create a Run

```bash
curl -X POST http://localhost:8080/v1/runs \
  -H "Authorization: Bearer fd_dev_key_abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "agt_01JFVX0000000000000000001",
    "input": {
      "task": "Analyze the README file in the ferrumdeck repo"
    }
  }'
```

### Check Run Status

```bash
curl http://localhost:8080/v1/runs/{run_id} \
  -H "Authorization: Bearer fd_dev_key_abc123"
```

### List Steps

```bash
curl http://localhost:8080/v1/runs/{run_id}/steps \
  -H "Authorization: Bearer fd_dev_key_abc123"
```

### List Pending Approvals

```bash
curl http://localhost:8080/v1/approvals \
  -H "Authorization: Bearer fd_dev_key_abc123"
```

### Approve an Action

```bash
curl -X POST http://localhost:8080/v1/approvals/{approval_id}/approve \
  -H "Authorization: Bearer fd_dev_key_abc123"
```

## Example Tasks to Try

### 1. Read a File
```json
{
  "task": "Read the package.json from the vercel/next.js repository and summarize its dependencies"
}
```

### 2. Analyze a Repository
```json
{
  "task": "Search for all TypeScript files in the microsoft/vscode repo that contain 'authentication'"
}
```

### 3. Create an Issue (Requires Approval)
```json
{
  "task": "Create an issue in my repo owner/myrepo with title 'Bug: Login button not working' and describe the problem"
}
```

## Service URLs

| Service | URL | Description |
|---------|-----|-------------|
| Dashboard | http://localhost:8000 | Web UI for monitoring |
| Gateway | http://localhost:8080 | REST API |
| Jaeger | http://localhost:16686 | Distributed tracing |
| PostgreSQL | localhost:5433 | Database |
| Redis | localhost:6379 | Queue & cache |

## Troubleshooting

### "Connection refused" errors
```bash
# Check if services are running
make dev-ps

# View logs
make dev-logs
```

### Agent not responding
- Check that `ANTHROPIC_API_KEY` is set in `.env`
- Ensure the worker is running: check Docker logs or run `make run-worker`

### GitHub tools not working
- Check that `GITHUB_TOKEN` is set in `.env`
- Ensure the token has appropriate permissions (repo, read:org)

### Reset everything
```bash
make dev-down
make clean-docker
make dev-up
```

## Development Commands

```bash
# Infrastructure
make dev-up        # Start services
make dev-down      # Stop services
make dev-logs      # View logs
make dev-ps        # Check status

# Run locally (instead of Docker)
make run-gateway   # Terminal 1
make run-worker    # Terminal 2
make run-dashboard # Terminal 3

# Code quality
make fmt           # Format code
make lint          # Lint code
make test          # Run tests

# Database
make db-reset      # Reset database
make db-migrate    # Run migrations
```

## Next Steps

1. **Explore the API** - Check out `/docs/api/` for full API documentation
2. **Create Custom Agents** - Define agents in `/evals/agents/`
3. **Run Evaluations** - Test agent quality with `make eval-run`
4. **Add MCP Tools** - Extend capabilities in `/python/packages/fd-mcp-tools/`
