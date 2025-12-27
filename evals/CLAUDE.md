# Evaluation Framework

<!-- AUTO-MANAGED: module-description -->
## Purpose

The evals directory contains configuration and data for the FerrumDeck evaluation framework. Evals test agent behaviors, measure quality, and ensure governance compliance.

**Role**: Define test suites, datasets, and scoring criteria for evaluating agent performance.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: architecture -->
## Module Architecture

```
evals/
├── suites/                   # Test suite definitions
│   └── *.yaml                # Suite configs (tasks, scorers)
├── datasets/                 # Test data
│   └── *.json                # Input/expected output pairs
├── agents/                   # Agent configurations
│   └── *.yaml                # Agent definitions for testing
├── scorers/                  # Custom scorer configs
│   └── *.yaml                # Scorer parameters
└── reports/                  # Generated reports (gitignored)
    ├── *.json                # Raw eval results
    └── *.html                # Rendered reports
```

**Framework Code**: The evaluation framework implementation is in `python/packages/fd-evals/`.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: conventions -->
## Module-Specific Conventions

### Suite Definition
```yaml
# suites/code-quality.yaml
name: Code Quality Suite
description: Evaluate code generation quality
tasks:
  - dataset: datasets/coding-tasks.json
    scorers:
      - type: code_quality
        config:
          check_syntax: true
          check_style: true
```

### Dataset Format
```json
{
  "tasks": [
    {
      "id": "task-001",
      "input": "Write a function to...",
      "expected": { "contains": ["def ", "return"] },
      "metadata": { "difficulty": "easy" }
    }
  ]
}
```

### Running Evals
```bash
# Run all suites
make eval-run

# Run specific suite
uv run python -m fd_evals run --suite suites/code-quality.yaml

# Generate report
make eval-report
```

### Built-in Scorers
- `code_quality` - Syntax, style, complexity
- `security` - Vulnerability detection
- `files` - File operation validation
- `pr` - Pull request quality
- `llm_judge` - LLM-as-judge scoring

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: dependencies -->
## Key Dependencies

Evals use the `fd-evals` package from `python/packages/fd-evals/`.

| Component | Purpose |
|-----------|---------|
| `fd_evals.runner` | Execute evaluation suites |
| `fd_evals.suite` | Suite loading and management |
| `fd_evals.task` | Task definitions |
| `fd_evals.scorers` | Built-in scoring functions |
| `fd_evals.replay` | Replay previous runs |
| `fd_evals.delta` | Compare eval runs |

<!-- END AUTO-MANAGED -->

<!-- MANUAL -->
## Notes

<!-- END MANUAL -->
