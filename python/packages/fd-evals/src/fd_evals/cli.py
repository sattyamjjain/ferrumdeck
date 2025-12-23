"""FerrumDeck Evaluation CLI."""

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

import typer
from rich import print as rprint
from rich.console import Console
from rich.table import Table

from fd_evals.runner import EvalRunner
from fd_evals.scorers import (
    FilesChangedScorer,
    LintScorer,
    PRCreatedScorer,
    TestPassScorer,
)
from fd_evals.task import EvalRunSummary

app = typer.Typer(
    name="fd-eval",
    help="FerrumDeck Evaluation CLI - Run and analyze agent evaluations",
    no_args_is_help=True,
)

console = Console()


def get_default_scorers():
    """Get the default set of scorers."""
    return [
        FilesChangedScorer(weight=1.0),
        PRCreatedScorer(weight=1.0),
        TestPassScorer(weight=1.5),
        LintScorer(weight=0.5),
    ]


@app.command("run")
def run_eval(
    dataset: Annotated[
        Path,
        typer.Argument(
            help="Path to the evaluation dataset (tasks.jsonl)",
            exists=True,
        ),
    ],
    agent_id: Annotated[
        str,
        typer.Option("--agent", "-a", help="Agent ID to evaluate"),
    ] = "safe-pr-agent",
    output: Annotated[
        Path | None,
        typer.Option("--output", "-o", help="Output path for results JSON"),
    ] = None,
    max_tasks: Annotated[
        int | None,
        typer.Option("--max-tasks", "-n", help="Maximum number of tasks to run"),
    ] = None,
    timeout: Annotated[
        int,
        typer.Option("--timeout", "-t", help="Timeout per task in milliseconds"),
    ] = 300000,
    control_plane: Annotated[
        str,
        typer.Option("--control-plane", help="Control plane URL"),
    ] = "http://localhost:8080",
    api_key: Annotated[
        str | None,
        typer.Option("--api-key", help="API key for authentication"),
    ] = None,
    verbose: Annotated[
        bool,
        typer.Option("--verbose", "-v", help="Verbose output"),
    ] = False,
) -> None:
    """Run an evaluation against a dataset.

    This command executes all tasks in the dataset against the specified
    agent and generates a detailed evaluation report.
    """
    console.print("[cyan]Starting evaluation run...[/cyan]")
    console.print(f"  Dataset: {dataset}")
    console.print(f"  Agent: {agent_id}")

    runner = EvalRunner(
        scorers=get_default_scorers(),
        control_plane_url=control_plane,
        api_key=api_key,
    )

    summary = runner.run_eval(
        dataset_path=dataset,
        agent_id=agent_id,
        max_tasks=max_tasks,
        timeout_ms=timeout,
    )

    # Display results
    _display_summary(summary, verbose)

    # Save report if output specified
    if output:
        runner.save_report(summary, output)
        console.print(f"\n[green]Report saved to: {output}[/green]")

    # Exit with non-zero if any tasks failed
    if summary.failed_tasks > 0:
        raise typer.Exit(1)


@app.command("compare")
def compare_runs(
    baseline: Annotated[
        Path,
        typer.Argument(help="Baseline report JSON"),
    ],
    current: Annotated[
        Path,
        typer.Argument(help="Current report JSON"),
    ],
    output: Annotated[
        Path | None,
        typer.Option("--output", "-o", help="Output path for comparison report"),
    ] = None,
    fail_on_regression: Annotated[
        bool,
        typer.Option("--fail-on-regression", help="Exit with error if regression detected"),
    ] = True,
) -> None:
    """Compare two evaluation runs to detect regressions.

    Compares pass rates, scores, and costs between a baseline and current run.
    """
    with baseline.open() as f:
        baseline_data = json.load(f)

    with current.open() as f:
        current_data = json.load(f)

    comparison = _compare_summaries(baseline_data, current_data)
    _display_comparison(comparison)

    # Save comparison if output specified
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open("w") as f:
            json.dump(comparison, f, indent=2)
        console.print(f"\n[green]Comparison saved to: {output}[/green]")

    # Check for regressions
    if fail_on_regression and comparison.get("has_regression", False):
        console.print("\n[red]Regression detected! Failing.[/red]")
        raise typer.Exit(1)


@app.command("report")
def generate_report(
    results: Annotated[
        Path,
        typer.Argument(help="Path to results JSON"),
    ],
    format: Annotated[
        str,
        typer.Option("--format", "-f", help="Output format (text, json, markdown)"),
    ] = "text",
) -> None:
    """Generate a human-readable report from evaluation results."""
    with results.open() as f:
        data = json.load(f)

    if format == "json":
        rprint(json.dumps(data, indent=2))
    elif format == "markdown":
        _print_markdown_report(data)
    else:
        _display_summary_from_dict(data, verbose=True)


@app.command("list-tasks")
def list_tasks(
    dataset: Annotated[
        Path,
        typer.Argument(help="Path to the evaluation dataset"),
    ],
) -> None:
    """List all tasks in a dataset."""
    runner = EvalRunner()
    tasks = runner.load_tasks(dataset)

    table = Table(title=f"Tasks in {dataset.name}")
    table.add_column("ID", style="cyan")
    table.add_column("Name", style="green")
    table.add_column("Difficulty")
    table.add_column("Category")

    for task in tasks:
        table.add_row(
            task.id,
            task.name,
            task.difficulty,
            task.category,
        )

    console.print(table)
    console.print(f"\nTotal: {len(tasks)} tasks")


def _display_summary(summary: EvalRunSummary, verbose: bool = False) -> None:
    """Display evaluation summary in a table."""
    console.print("\n" + "=" * 60)
    console.print("[bold]Evaluation Summary[/bold]")
    console.print("=" * 60)

    # Overview table
    overview = Table(show_header=False, box=None)
    overview.add_column("Metric", style="cyan")
    overview.add_column("Value", style="green")

    overview.add_row("Run ID", summary.run_id)
    overview.add_row("Dataset", summary.dataset_name)
    overview.add_row("Total Tasks", str(summary.total_tasks))
    overview.add_row(
        "Passed",
        f"[green]{summary.passed_tasks}[/green] ({summary.pass_rate:.1f}%)",
    )
    overview.add_row(
        "Failed",
        f"[red]{summary.failed_tasks}[/red]" if summary.failed_tasks > 0 else "0",
    )
    overview.add_row("Average Score", f"{summary.average_score:.2f}")
    overview.add_row("Total Cost", f"${summary.total_cost_cents / 100:.4f}")
    overview.add_row("Total Tokens", f"{summary.total_input_tokens + summary.total_output_tokens:,}")
    overview.add_row("Execution Time", f"{summary.total_execution_time_ms / 1000:.1f}s")

    console.print(overview)

    # Results table
    if verbose or summary.failed_tasks > 0:
        console.print("\n[bold]Task Results:[/bold]")

        results_table = Table()
        results_table.add_column("Task", style="cyan")
        results_table.add_column("Status")
        results_table.add_column("Score")
        results_table.add_column("Time")
        results_table.add_column("Cost")

        for result in summary.results:
            status = "[green]PASS[/green]" if result.passed else "[red]FAIL[/red]"
            results_table.add_row(
                result.task_name[:30],
                status,
                f"{result.total_score:.2f}",
                f"{result.execution_time_ms / 1000:.1f}s",
                f"${result.cost_cents / 100:.4f}",
            )

        console.print(results_table)


def _display_summary_from_dict(data: dict, verbose: bool = False) -> None:
    """Display summary from dictionary data."""
    console.print("\n" + "=" * 60)
    console.print("[bold]Evaluation Summary[/bold]")
    console.print("=" * 60)

    overview = Table(show_header=False, box=None)
    overview.add_column("Metric", style="cyan")
    overview.add_column("Value", style="green")

    overview.add_row("Run ID", data.get("run_id", "N/A"))
    overview.add_row("Dataset", data.get("dataset_name", "N/A"))
    overview.add_row("Total Tasks", str(data.get("total_tasks", 0)))
    overview.add_row(
        "Pass Rate",
        f"{data.get('pass_rate', 0):.1f}%",
    )
    overview.add_row("Average Score", f"{data.get('average_score', 0):.2f}")
    overview.add_row("Total Cost", f"${data.get('total_cost_cents', 0) / 100:.4f}")

    console.print(overview)


def _compare_summaries(baseline: dict, current: dict) -> dict:
    """Compare two evaluation summaries."""
    baseline_pass_rate = baseline.get("pass_rate", 0)
    current_pass_rate = current.get("pass_rate", 0)
    pass_rate_delta = current_pass_rate - baseline_pass_rate

    baseline_score = baseline.get("average_score", 0)
    current_score = current.get("average_score", 0)
    score_delta = current_score - baseline_score

    baseline_cost = baseline.get("total_cost_cents", 0)
    current_cost = current.get("total_cost_cents", 0)
    cost_delta = current_cost - baseline_cost

    # Check for regressions
    has_regression = (
        pass_rate_delta < -5  # More than 5% drop in pass rate
        or score_delta < -0.1  # More than 0.1 drop in average score
    )

    # Compare individual tasks
    baseline_tasks = {r["task_id"]: r for r in baseline.get("results", [])}
    current_tasks = {r["task_id"]: r for r in current.get("results", [])}

    task_regressions = []
    task_improvements = []

    for task_id, current_result in current_tasks.items():
        baseline_result = baseline_tasks.get(task_id)
        if baseline_result:
            if baseline_result.get("passed") and not current_result.get("passed"):
                task_regressions.append(task_id)
            elif not baseline_result.get("passed") and current_result.get("passed"):
                task_improvements.append(task_id)

    return {
        "baseline_run_id": baseline.get("run_id"),
        "current_run_id": current.get("run_id"),
        "pass_rate": {
            "baseline": baseline_pass_rate,
            "current": current_pass_rate,
            "delta": pass_rate_delta,
        },
        "average_score": {
            "baseline": baseline_score,
            "current": current_score,
            "delta": score_delta,
        },
        "cost": {
            "baseline": baseline_cost,
            "current": current_cost,
            "delta": cost_delta,
            "delta_percent": (cost_delta / baseline_cost * 100) if baseline_cost > 0 else 0,
        },
        "task_regressions": task_regressions,
        "task_improvements": task_improvements,
        "has_regression": has_regression,
        "comparison_time": datetime.now(tz=UTC).isoformat(),
    }


def _display_comparison(comparison: dict) -> None:
    """Display comparison results."""
    console.print("\n" + "=" * 60)
    console.print("[bold]Evaluation Comparison[/bold]")
    console.print("=" * 60)

    # Overview
    console.print(f"\nBaseline: {comparison['baseline_run_id']}")
    console.print(f"Current:  {comparison['current_run_id']}")

    # Metrics table
    metrics = Table(title="Metrics Comparison")
    metrics.add_column("Metric", style="cyan")
    metrics.add_column("Baseline")
    metrics.add_column("Current")
    metrics.add_column("Delta")

    # Pass rate
    pr = comparison["pass_rate"]
    pr_color = "[green]" if pr["delta"] >= 0 else "[red]"
    metrics.add_row(
        "Pass Rate",
        f"{pr['baseline']:.1f}%",
        f"{pr['current']:.1f}%",
        f"{pr_color}{pr['delta']:+.1f}%[/]",
    )

    # Score
    sc = comparison["average_score"]
    sc_color = "[green]" if sc["delta"] >= 0 else "[red]"
    metrics.add_row(
        "Average Score",
        f"{sc['baseline']:.2f}",
        f"{sc['current']:.2f}",
        f"{sc_color}{sc['delta']:+.2f}[/]",
    )

    # Cost
    co = comparison["cost"]
    co_color = "[green]" if co["delta"] <= 0 else "[yellow]"
    metrics.add_row(
        "Total Cost",
        f"${co['baseline'] / 100:.4f}",
        f"${co['current'] / 100:.4f}",
        f"{co_color}${co['delta'] / 100:+.4f} ({co['delta_percent']:+.1f}%)[/]",
    )

    console.print(metrics)

    # Regressions and improvements
    if comparison["task_regressions"]:
        console.print(f"\n[red]Regressions ({len(comparison['task_regressions'])}):[/red]")
        for task_id in comparison["task_regressions"]:
            console.print(f"  - {task_id}")

    if comparison["task_improvements"]:
        console.print(f"\n[green]Improvements ({len(comparison['task_improvements'])}):[/green]")
        for task_id in comparison["task_improvements"]:
            console.print(f"  + {task_id}")

    # Final verdict
    if comparison["has_regression"]:
        console.print("\n[red bold]REGRESSION DETECTED[/red bold]")
    else:
        console.print("\n[green bold]NO REGRESSIONS[/green bold]")


def _print_markdown_report(data: dict) -> None:
    """Print a markdown-formatted report."""
    print(f"# Evaluation Report: {data.get('run_id', 'Unknown')}\n")
    print(f"**Dataset:** {data.get('dataset_name', 'Unknown')}")
    print(f"**Date:** {data.get('started_at', 'Unknown')}\n")

    print("## Summary\n")
    print("| Metric | Value |")
    print("|--------|-------|")
    print(f"| Total Tasks | {data.get('total_tasks', 0)} |")
    print(f"| Passed | {data.get('passed_tasks', 0)} |")
    print(f"| Failed | {data.get('failed_tasks', 0)} |")
    print(f"| Pass Rate | {data.get('pass_rate', 0):.1f}% |")
    print(f"| Average Score | {data.get('average_score', 0):.2f} |")
    print(f"| Total Cost | ${data.get('total_cost_cents', 0) / 100:.4f} |\n")

    if data.get("results"):
        print("## Task Results\n")
        print("| Task | Status | Score |")
        print("|------|--------|-------|")
        for result in data["results"]:
            status = "PASS" if result.get("passed") else "FAIL"
            print(f"| {result.get('task_name', 'Unknown')} | {status} | {result.get('total_score', 0):.2f} |")


def main():
    """Entry point for the CLI."""
    app()


if __name__ == "__main__":
    main()
