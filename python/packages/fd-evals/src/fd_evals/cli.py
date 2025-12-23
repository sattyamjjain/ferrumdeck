"""CLI for running evaluations."""

import argparse
import asyncio
import json
import logging
from pathlib import Path

from rich.console import Console
from rich.table import Table

from fd_evals.suite import EvalResult, EvalSuite, EvalTask

console = Console()
logging.basicConfig(level=logging.INFO)


def main():
    parser = argparse.ArgumentParser(description="FerrumDeck Evaluation Harness")
    subparsers = parser.add_subparsers(dest="command", help="Commands")

    # Run command
    run_parser = subparsers.add_parser("run", help="Run evaluation suite")
    run_parser.add_argument("dataset", help="Path to dataset directory")
    run_parser.add_argument("--output", "-o", help="Output file for results")

    # Report command
    report_parser = subparsers.add_parser("report", help="Generate report from results")
    report_parser.add_argument("results", help="Path to results JSON file")

    args = parser.parse_args()

    if args.command == "run":
        asyncio.run(run_eval(args.dataset, args.output))
    elif args.command == "report":
        generate_report(args.results)
    else:
        parser.print_help()


async def run_eval(dataset_path: str, output_path: str | None):
    """Run evaluation suite."""
    console.print(f"[bold]Running evaluation suite: {dataset_path}[/bold]")

    suite = EvalSuite(dataset_path)
    suite.load()

    console.print(f"Loaded {len(suite.tasks)} tasks")

    # TODO: Create actual runner that uses the agent
    async def mock_runner(task: EvalTask) -> EvalResult:
        return EvalResult(
            task_id=task.id,
            passed=True,
            score=1.0,
            actual={"mock": True},
            expected=task.expected,
        )

    results = await suite.run(mock_runner)
    summary = suite.summary(results)

    # Print summary
    table = Table(title="Evaluation Results")
    table.add_column("Metric", style="cyan")
    table.add_column("Value", style="green")

    table.add_row("Total Tasks", str(summary["total"]))
    table.add_row("Passed", str(summary["passed"]))
    table.add_row("Failed", str(summary["failed"]))
    table.add_row("Pass Rate", f"{summary['pass_rate']:.1%}")
    table.add_row("Avg Score", f"{summary['average_score']:.2f}")

    console.print(table)

    # Save results
    if output_path:
        with Path(output_path).open("w") as f:
            json.dump(
                {
                    "summary": summary,
                    "results": [r.model_dump() for r in results],
                },
                f,
                indent=2,
            )
        console.print(f"Results saved to: {output_path}")


def generate_report(results_path: str):
    """Generate report from results file."""
    with Path(results_path).open() as f:
        data = json.load(f)

    console.print("[bold]Evaluation Report[/bold]")
    console.print_json(json.dumps(data["summary"], indent=2))


if __name__ == "__main__":
    main()
