# fd-evals

FerrumDeck Evaluation Framework - Deterministic eval harness for agent workflows.

## Features

- **Deterministic Scorers**: Test pass/fail, schema validation, file changes, PR creation
- **Eval Runner**: Execute tasks against agents and collect metrics
- **Regression Reports**: Compare runs to detect performance regressions
- **CLI Interface**: Easy-to-use command line tool

## Installation

```bash
pip install fd-evals
```

## Usage

### Run an evaluation

```bash
fd-eval run evals/datasets/safe-pr-agent/tasks.jsonl --agent safe-pr-agent -o report.json
```

### Compare runs

```bash
fd-eval compare baseline.json current.json --fail-on-regression
```

### List tasks

```bash
fd-eval list-tasks evals/datasets/safe-pr-agent/tasks.jsonl
```

## Scorers

- `TestPassScorer`: Checks if tests pass
- `FilesChangedScorer`: Verifies expected files were modified
- `PRCreatedScorer`: Confirms PR was created
- `LintScorer`: Checks linting results
- `SchemaScorer`: Validates output against JSON schema
- `CompositeScorer`: Combines multiple scorers with weights

## License

MIT
