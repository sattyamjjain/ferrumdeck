# Evaluation Framework

<!-- AUTO-MANAGED: module-description -->
## Purpose

Configuration and data for the eval + benchmark framework. This directory holds suites, datasets, agent definitions
and reports; the code that runs them lives in `python/packages/fd-evals`. Two distinct kinds of run live here:
LLM-backed quality suites (smoke, regression) and deterministic offline governance benchmarks that gate PRs.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: architecture -->
## Module Architecture

```
evals/
├── suites/
│   ├── smoke.yaml              # Quick end-to-end validation (needs ANTHROPIC_API_KEY)
│   ├── regression.yaml         # Full regression
│   ├── asb/suite.yaml          # Agent Security Bench + EU AI Act Art.50 (offline, seeded)
│   └── injection_defense/      # Prompt-injection defense benchmark (offline, no LLM)
├── datasets/
│   ├── safe-pr-agent/          # Task inputs for the reference agent
│   ├── asb/ · injection_defense/
│   └── governed_benchmark/     # Governed vs ungoverned overhead comparison
├── agents/safe-pr-agent/       # Agent definition under test
├── reports/                    # Run output (JSON) — inputs to delta/report commands
└── enforce_vs_observe.py       # Enforce-vs-shadow comparison entry point
```

Suite YAML shape: `name`, `description`, `datasets` (path + optional `filter`), `scorers` (typed entries),
`settings` (`timeout_ms`, `max_parallel`).

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: conventions -->
## Module-Specific Conventions

- **Two tiers, different rules.** Governance benchmarks (`asb`, `injection_defense`, `governed_benchmark`,
  `enforce_vs_observe`) must be deterministic, offline, seeded, and LLM-free so CI can gate on them. Quality suites
  (`smoke`, `regression`) may call an LLM and require `ANTHROPIC_API_KEY`.
- Never fabricate a run. Reports must come from an actual execution — the repo has explicit CI gates and past fixes
  against mock or synthesized eval output.
- Datasets are versioned JSON with `tasks[]` carrying `id`, `input`, `expected`, `metadata`.
- Scorers are referenced by `type` in suite YAML and resolved through `SCORER_REGISTRY` in
  `fd_evals/suite.py` (the classes are exported from `fd_evals/scorers/__init__.py`, but that is not the
  lookup table). Registry keys are the public contract of a suite file — keep them stable. `build_scorer`
  raises `SuiteError` on an unknown type; it never silently falls back to a default.
- **Not every low score means the agent did badly.** The scorers in `UNOBSERVABLE_SCORERS`
  (`files_changed`, `pr_created`, `tests_pass`, `lint_pass`) read run fields the control plane does not
  surface. A suite selecting them is asserting on data the harness cannot observe, so the runner reports
  that rather than scoring 0. Read `assertion_coverage` before quoting any number, and never point an
  output scorer at a mock stand-in.
- Paths inside suite YAML are relative to `evals/`.

```bash
make eval-run                 # smoke, against agt_01JFVX0000000000000000001
make eval-run-full            # regression
make eval-asb                 # offline, --seed 0
make eval-injection-defense   # offline, no LLM
make bench-governed           # overhead + blocked % vs ungoverned
make eval-report              # report from the latest results
```

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: dependencies -->
## Key Dependencies

Runner package `fd-evals` (`python/packages/fd-evals`) depends on:

| Dependency | Role |
|---|---|
| `fd-runtime` | Workflow models, gateway client, tracing |
| `httpx` | Gateway API calls |
| `pydantic` ≥2 | Task / report / scorer result models |
| `pyyaml` | Suite configuration parsing |
| `jsonschema` | Schema-validity scoring |
| `typer` + `rich` | CLI and report rendering |
| `opentelemetry-sdk` | Spans for eval runs |

Invoked as `uv run python -m fd_evals <command>`; a running gateway is required for suites that execute agents,
but the offline governance benchmarks need neither a gateway nor an API key.

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
