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
## Creating Custom Scorers

### Scorer Interface
```python
# python/packages/fd-evals/src/fd_evals/scorers/my_scorer.py
from fd_evals.scorer import Scorer, ScorerResult

class MyScorer(Scorer):
    """Custom scorer for specific evaluation criteria."""

    name = "my_scorer"

    def __init__(self, threshold: float = 0.8, **kwargs):
        super().__init__(**kwargs)
        self.threshold = threshold

    async def score(
        self,
        task_input: str,
        expected: dict,
        actual: str,
        metadata: dict | None = None
    ) -> ScorerResult:
        # Implement scoring logic
        score = self._calculate_score(expected, actual)

        return ScorerResult(
            scorer_id=self.name,
            scorer_name="My Custom Scorer",
            score=score,
            passed=score >= self.threshold,
            details=f"Score: {score:.2%}",
            metadata={"threshold": self.threshold}
        )

    def _calculate_score(self, expected: dict, actual: str) -> float:
        # Your scoring logic here
        return 1.0 if expected.get("key") in actual else 0.0
```

### Registering a Scorer
```python
# In fd_evals/scorers/__init__.py
from .my_scorer import MyScorer

SCORERS = {
    "my_scorer": MyScorer,
    # ... other scorers
}
```

### Using in Suite Config
```yaml
# suites/custom.yaml
name: Custom Evaluation
tasks:
  - dataset: datasets/test.json
    scorers:
      - type: my_scorer
        config:
          threshold: 0.9
```

## Creating New Datasets

### Dataset Structure
```json
{
  "name": "My Test Dataset",
  "description": "Tests for specific functionality",
  "version": "1.0.0",
  "tasks": [
    {
      "id": "task-001",
      "input": "The prompt or input to the agent",
      "expected": {
        "contains": ["expected", "keywords"],
        "not_contains": ["forbidden", "terms"],
        "tool_calls": ["read_file", "write_file"],
        "custom_field": "for custom scorers"
      },
      "metadata": {
        "difficulty": "easy|medium|hard",
        "category": "security|quality|functionality",
        "tags": ["tag1", "tag2"]
      }
    }
  ]
}
```

### Expected Field Options
```json
{
  "expected": {
    "contains": ["must", "include", "these"],
    "not_contains": ["must", "not", "include"],
    "regex": "pattern.*match",
    "tool_calls": ["required_tool"],
    "tool_sequence": ["tool_a", "tool_b"],
    "exact_match": false,
    "min_length": 100,
    "max_length": 5000
  }
}
```

## Creating New Suites

### Suite Structure
```yaml
# suites/my_suite.yaml
name: My Evaluation Suite
description: Comprehensive tests for feature X
version: "1.0.0"

# Global settings
settings:
  timeout_seconds: 300
  max_retries: 2
  parallel: 4

# Tasks to run
tasks:
  # Reference existing dataset
  - dataset: datasets/feature-x/basic.json
    scorers:
      - type: code_quality
      - type: security
        config:
          check_injection: true

  # Inline task definition
  - inline:
      id: quick-test-001
      input: "Quick sanity check"
      expected:
        contains: ["success"]
    scorers:
      - type: llm_judge
        config:
          model: claude-3-haiku
          rubric: "Response should be helpful"
```

### Running Specific Suites
```bash
# Run custom suite
uv run python -m fd_evals run --suite evals/suites/my_suite.yaml

# With specific output
uv run python -m fd_evals run \
  --suite evals/suites/my_suite.yaml \
  --output evals/reports/my_run.json

# Multiple runs for consistency
uv run python -m fd_evals run \
  --suite evals/suites/my_suite.yaml \
  --runs 5
```

## LLM-as-Judge Scorer

### Configuration
```yaml
scorers:
  - type: llm_judge
    config:
      model: claude-3-haiku-20240307  # Fast and cheap
      temperature: 0.0
      rubric: |
        Evaluate the response based on:
        1. Accuracy - Is the information correct?
        2. Completeness - Does it address all aspects?
        3. Clarity - Is it well-structured and clear?

        Score from 0.0 to 1.0.
      threshold: 0.7
```

### Custom Rubrics
```yaml
# For code review tasks
rubric: |
  Evaluate this code review:
  - Does it identify the main issues? (0-0.3)
  - Are suggestions actionable? (0-0.3)
  - Is the tone professional? (0-0.2)
  - Does it suggest tests? (0-0.2)

# For security tasks
rubric: |
  Evaluate the security assessment:
  - Are all vulnerabilities identified? (0-0.4)
  - Are severity ratings accurate? (0-0.3)
  - Are remediation steps provided? (0-0.3)
```

## Comparing Eval Runs

### Delta Analysis
```bash
# Compare two runs
uv run python -m fd_evals delta \
  evals/reports/baseline.json \
  evals/reports/current.json

# Output shows:
# - Tasks that improved
# - Tasks that regressed
# - Score differences per scorer
```

### Replaying Failed Tasks
```bash
# Replay only failed tasks from a run
uv run python -m fd_evals replay \
  --report evals/reports/run.json \
  --filter failed
```

## CI Integration

### GitHub Actions
```yaml
# Evals run automatically on schedule and manual trigger
# See .github/workflows/evals.yml

# Key points:
# - Smoke suite for quick validation
# - Full regression for releases
# - Reports uploaded as artifacts
# - Regression detection (>10% drop fails)
```

### Eval Gating
- PRs to main require smoke evals to pass
- Release branches require full regression
- 95% consistency required for MVP validation

## Debugging Failed Evals

### Verbose Output
```bash
uv run python -m fd_evals run \
  --suite evals/suites/smoke.yaml \
  --verbose
```

### Inspect Specific Task
```bash
# Run single task
uv run python -m fd_evals run-task \
  --task datasets/safe-pr-agent/basic.json#task-001 \
  --debug
```

### Common Issues

**Timeout Errors**
- Increase `timeout_seconds` in suite config
- Check if agent is waiting for approval

**Scorer Failures**
- Verify expected format matches scorer requirements
- Check scorer config parameters

**Flaky Results**
- Increase runs count for consistency check
- Use deterministic scorers (not LLM judge) for CI

<!-- END MANUAL -->
