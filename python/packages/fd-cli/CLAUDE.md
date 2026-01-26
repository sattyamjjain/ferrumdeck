# fd-cli

<!-- AUTO-MANAGED: module-description -->
## Purpose

Command-line interface for interacting with the FerrumDeck control plane. Provides commands for managing runs, agents, tools, and viewing logs.

**Role**: Developer interface - CLI for local development and debugging.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: architecture -->
## Module Architecture

```
fd-cli/src/fd_cli/
├── __init__.py       # Package exports
└── main.py           # Typer CLI application
```

**Commands**:
- `fd run list` - List recent runs
- `fd run get <id>` - Get run details
- `fd run cancel <id>` - Cancel running run
- `fd agent list` - List registered agents
- `fd tool list` - List available tools
- `fd logs <run-id>` - Stream run logs

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: conventions -->
## Module-Specific Conventions

### CLI Structure
```python
import typer
from rich.console import Console

app = typer.Typer()
console = Console()

@app.command()
def run_list():
    """List recent runs."""
    runs = client.list_runs()
    console.print_json(data=runs)
```

### Output Formatting
- Use `rich` for colored terminal output
- JSON output with `--json` flag
- Table format by default for lists

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: dependencies -->
## Key Dependencies

| Package | Purpose |
|---------|---------|
| `fd-runtime` | Gateway client |
| `typer` | CLI framework |
| `rich` | Terminal formatting |
| `httpx` | HTTP client |

<!-- END AUTO-MANAGED -->

<!-- MANUAL -->
## Usage

```bash
# List runs
fd run list

# Get run details
fd run get run_01HGXK...

# Cancel a run
fd run cancel run_01HGXK...

# Stream logs
fd logs run_01HGXK...

# List agents
fd agent list

# List tools
fd tool list
```

## Environment Variables

```bash
GATEWAY_URL=http://localhost:8080
FD_API_KEY=fd_dev_key_abc123
```

<!-- END MANUAL -->
