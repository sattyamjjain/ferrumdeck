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
│   ├── smoke.yaml            # Quick smoke tests
│   └── regression.yaml       # Full regression suite
├── datasets/                 # Test data
│   └── safe-pr-agent/        # Safe PR Agent test cases
│       └── *.json            # Input/expected output pairs
├── agents/                   # Agent configurations
│   └── safe-pr-agent/        # Agent definitions for testing
│       └── *.yaml            # Agent config files
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
# suites/smoke.yaml
name: Smoke Suite
description: Quick validation tests
tasks:
  - dataset: datasets/safe-pr-agent/basic.json
    scorers:
      - type: pr_quality
        config:
          check_description: true
          check_files: true
```

### Dataset Format
```json
{
  "tasks": [
    {
      "id": "task-001",
      "input": "Review this PR...",
      "expected": { "contains": ["LGTM", "approved"] },
      "metadata": { "difficulty": "easy" }
    }
  ]
}
```

### Running Evals
```bash
# Run smoke suite
make eval-run

# Run full regression
make eval-run-full

# Run specific suite
FD_API_KEY=fd_dev_key_abc123 uv run python -m fd_evals run \
  --suite evals/suites/smoke.yaml \
  --agent agt_01JFVX0000000000000000001

# Generate report from latest results
make eval-report
```

### Built-in Scorers
- `code_quality` - Syntax, style, complexity
- `security` - Vulnerability detection
- `files` - File operation validation
- `pr_quality` - Pull request quality
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
