"""FerrumDeck CLI main entry point."""

import json
import os
from typing import Annotated

import httpx
import typer
from rich import print as rprint
from rich.console import Console
from rich.table import Table

app = typer.Typer(
    name="fd",
    help="FerrumDeck CLI - Manage agent runs and workflows",
    no_args_is_help=True,
)

console = Console()

# Sub-apps
run_app = typer.Typer(help="Manage agent runs")
agent_app = typer.Typer(help="Manage agents")

app.add_typer(run_app, name="run")
app.add_typer(agent_app, name="agent")


def get_client() -> httpx.Client:
    """Get an HTTP client configured for the control plane."""
    base_url = os.getenv("FD_CONTROL_PLANE_URL", "http://localhost:8080")
    api_key = os.getenv("FD_API_KEY")

    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    return httpx.Client(base_url=base_url, headers=headers, timeout=30.0)


@run_app.command("create")
def run_create(
    agent_id: Annotated[str, typer.Option("--agent", "-a", help="Agent ID to run")],
    input_data: Annotated[
        str | None, typer.Option("--input", "-i", help="JSON input data")
    ] = None,
    input_file: Annotated[
        str | None, typer.Option("--input-file", "-f", help="JSON file with input data")
    ] = None,
) -> None:
    """Create a new agent run."""
    # Parse input
    if input_file:
        from pathlib import Path

        with Path(input_file).open() as f:
            parsed_input = json.load(f)
    elif input_data:
        parsed_input = json.loads(input_data)
    else:
        parsed_input = {}

    with get_client() as client:
        response = client.post(
            "/v1/runs",
            json={
                "agent_id": agent_id,
                "input": parsed_input,
            },
        )

        if response.status_code != 201:
            console.print(f"[red]Error: {response.status_code}[/red]")
            console.print(response.text)
            raise typer.Exit(1)

        run = response.json()
        console.print(f"[green]Created run:[/green] {run['id']}")
        console.print(f"Status: {run['status']}")


@run_app.command("status")
def run_status(
    run_id: Annotated[str, typer.Argument(help="Run ID to check")],
) -> None:
    """Get the status of a run."""
    with get_client() as client:
        response = client.get(f"/v1/runs/{run_id}")

        if response.status_code != 200:
            console.print(f"[red]Error: {response.status_code}[/red]")
            console.print(response.text)
            raise typer.Exit(1)

        run = response.json()

        table = Table(title=f"Run: {run['id']}")
        table.add_column("Field", style="cyan")
        table.add_column("Value", style="green")

        table.add_row("Status", run["status"])
        table.add_row("Agent Version", run.get("agent_version_id", run.get("agent_id", "N/A")))
        table.add_row("Created", run.get("created_at", "N/A"))

        if run.get("started_at"):
            table.add_row("Started", run["started_at"])
        if run.get("completed_at"):
            table.add_row("Completed", run["completed_at"])

        # Budget info
        if "budget_usage" in run:
            usage = run["budget_usage"]
            table.add_row("Input Tokens", str(usage.get("input_tokens_used", 0)))
            table.add_row("Output Tokens", str(usage.get("output_tokens_used", 0)))
            table.add_row("Tool Calls", str(usage.get("tool_calls_used", 0)))

        console.print(table)


@run_app.command("steps")
def run_steps(
    run_id: Annotated[str, typer.Argument(help="Run ID to list steps for")],
) -> None:
    """List steps for a run."""
    with get_client() as client:
        response = client.get(f"/v1/runs/{run_id}/steps")

        if response.status_code != 200:
            console.print(f"[red]Error: {response.status_code}[/red]")
            console.print(response.text)
            raise typer.Exit(1)

        steps = response.json()

        if not steps:
            console.print("[yellow]No steps found for this run[/yellow]")
            return

        table = Table(title=f"Steps for Run: {run_id}")
        table.add_column("Step ID", style="cyan")
        table.add_column("Type", style="magenta")
        table.add_column("Status", style="green")
        table.add_column("Tokens (In/Out)")

        for step in steps:
            tokens = "-"
            if step.get("input_tokens") or step.get("output_tokens"):
                tokens = f"{step.get('input_tokens', 0)}/{step.get('output_tokens', 0)}"

            table.add_row(
                step["id"],
                step["step_type"],
                step["status"],
                tokens,
            )

        console.print(table)


@run_app.command("logs")
def run_logs(
    run_id: Annotated[str, typer.Argument(help="Run ID to get logs for")],
    follow: Annotated[bool, typer.Option("--follow", "-f", help="Follow log output")] = False,
    poll_interval: Annotated[
        float, typer.Option("--interval", "-i", help="Poll interval in seconds")
    ] = 1.0,
) -> None:
    """View logs for a run.

    Use --follow to stream logs in real-time until the run completes.
    """
    import time

    seen_steps: set[str] = set()
    terminal_statuses = {"completed", "failed", "cancelled", "timeout", "budget_killed"}

    def print_step(step: dict[str, object]) -> None:
        """Print a step's log output."""
        step_id = str(step.get("id", "unknown"))
        step_type = step.get("step_type", "unknown")
        status = step.get("status", "unknown")

        # Status color
        status_color = "green" if status == "completed" else "red" if status == "failed" else "yellow"

        console.print(f"\n[cyan]━━━ Step {step_id} ({step_type}) ━━━[/cyan]")
        console.print(f"  Status: [{status_color}]{status}[/{status_color}]")

        # Timing info
        if step.get("started_at"):
            console.print(f"  Started: {step['started_at']}")
        if step.get("completed_at"):
            console.print(f"  Completed: {step['completed_at']}")

        # Token usage
        input_tokens = step.get("input_tokens", 0)
        output_tokens = step.get("output_tokens", 0)
        if input_tokens or output_tokens:
            console.print(f"  Tokens: {input_tokens} in / {output_tokens} out")

        # Output
        if step.get("output"):
            console.print("  [dim]Output:[/dim]")
            output = step["output"]
            if isinstance(output, dict):
                # Pretty print JSON output
                for key, value in output.items():
                    if isinstance(value, str) and len(value) > 200:
                        value = value[:200] + "..."
                    console.print(f"    {key}: {value}")
            else:
                rprint(f"    {output}")

        # Error
        if step.get("error"):
            console.print(f"  [red]Error: {step['error']}[/red]")

    def fetch_and_print() -> tuple[str, list[dict[str, object]]]:
        """Fetch run status and print new steps."""
        with get_client() as client:
            # Get run status
            run_response = client.get(f"/v1/runs/{run_id}")
            if run_response.status_code != 200:
                console.print(f"[red]Error fetching run: {run_response.status_code}[/red]")
                raise typer.Exit(1)

            run = run_response.json()
            run_status = str(run.get("status", "unknown"))

            # Get steps
            steps_response = client.get(f"/v1/runs/{run_id}/steps")
            if steps_response.status_code != 200:
                console.print(f"[red]Error fetching steps: {steps_response.status_code}[/red]")
                raise typer.Exit(1)

            steps: list[dict[str, object]] = steps_response.json()

            # Print new or updated steps
            for step in steps:
                step_id = str(step.get("id", ""))
                step_status = step.get("status", "")

                # Create a unique key for step state
                step_key = f"{step_id}:{step_status}"

                if step_key not in seen_steps:
                    seen_steps.add(step_key)
                    # Only print if step has progressed (not just pending)
                    if step_status != "pending" or step_id not in [s.split(":")[0] for s in seen_steps]:
                        print_step(step)

            return run_status, steps

    # Initial fetch
    console.print(f"[bold]Logs for run: {run_id}[/bold]")

    if follow:
        console.print("[dim]Following logs... (Ctrl+C to stop)[/dim]\n")

        try:
            while True:
                run_status, _ = fetch_and_print()

                if run_status in terminal_statuses:
                    console.print(f"\n[bold]Run {run_status}[/bold]")
                    break

                time.sleep(poll_interval)

        except KeyboardInterrupt:
            console.print("\n[yellow]Stopped following logs[/yellow]")
    else:
        fetch_and_print()
        console.print()  # Final newline


@run_app.command("list")
def run_list(
    status: Annotated[str | None, typer.Option("--status", "-s", help="Filter by status")] = None,
    limit: Annotated[int, typer.Option("--limit", "-n", help="Maximum runs to show")] = 20,
) -> None:
    """List recent runs."""
    with get_client() as client:
        params = {"limit": limit}
        if status:
            params["status"] = status

        response = client.get("/v1/runs", params=params)

        if response.status_code != 200:
            console.print(f"[red]Error: {response.status_code}[/red]")
            console.print(response.text)
            raise typer.Exit(1)

        runs = response.json()

        if not runs:
            console.print("[yellow]No runs found[/yellow]")
            return

        table = Table(title="Recent Runs")
        table.add_column("Run ID", style="cyan")
        table.add_column("Agent", style="magenta")
        table.add_column("Status", style="green")
        table.add_column("Created")

        for run in runs:
            table.add_row(
                run["id"],
                run.get("agent_version_id", run.get("agent_id", "N/A")),
                run["status"],
                run.get("created_at", "N/A"),
            )

        console.print(table)


@agent_app.command("list")
def agent_list() -> None:
    """List available agents."""
    with get_client() as client:
        response = client.get("/v1/registry/agents")

        if response.status_code != 200:
            console.print(f"[red]Error: {response.status_code}[/red]")
            console.print(response.text)
            raise typer.Exit(1)

        agents = response.json()

        if not agents:
            console.print("[yellow]No agents registered[/yellow]")
            return

        table = Table(title="Registered Agents")
        table.add_column("Agent ID", style="cyan")
        table.add_column("Name", style="green")
        table.add_column("Version")
        table.add_column("Status")

        for agent in agents:
            table.add_row(
                agent["id"],
                agent.get("name", "N/A"),
                agent.get("version", "N/A"),
                agent.get("status", "N/A"),
            )

        console.print(table)


@app.command()
def version() -> None:
    """Show CLI version."""
    from fd_cli import __version__

    console.print(f"fd-cli version {__version__}")


@app.command()
def config() -> None:
    """Show current configuration."""
    table = Table(title="Configuration")
    table.add_column("Setting", style="cyan")
    table.add_column("Value", style="green")

    table.add_row(
        "Control Plane URL",
        os.getenv("FD_CONTROL_PLANE_URL", "http://localhost:8080"),
    )
    table.add_row(
        "API Key",
        "***" + os.getenv("FD_API_KEY", "")[-4:] if os.getenv("FD_API_KEY") else "Not set",
    )

    console.print(table)


if __name__ == "__main__":
    app()
