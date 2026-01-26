# fd-evals

<!-- AUTO-MANAGED: module-description -->
## Purpose

Evaluation framework for testing agent workflows. Provides deterministic test harness with configurable scorers for measuring agent quality and safety.

**Role**: Quality assurance - validates agents behave correctly before deployment.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: architecture -->
## Module Architecture

```
fd-evals/src/fd_evals/
├── __init__.py       # Package exports
├── __main__.py       # Entry point (python -m fd_evals)
├── cli.py            # Typer CLI (fd-eval command)
├── runner.py         # Evaluation runner
├── task.py           # Task definitions
├── replay.py         # Run replay for debugging
├── delta.py          # Delta comparison between runs
└── scorers/          # Scoring implementations
    ├── __init__.py
    ├── base.py       # Scorer base class
    ├── schema.py     # JSON schema validation
    ├── files.py      # File output scoring
    ├── pr.py         # PR quality scoring
    ├── tests.py      # Test pass/fail scoring
    ├── security.py   # Security policy scoring
    ├── code_quality.py  # Code quality metrics
    └── llm_judge.py  # LLM-as-judge scoring
```

**Eval Flow**:
```
Suite Config → Runner → Task Execution
                           ↓
                     Agent Runs (via Gateway)
                           ↓
                     Scorer Execution
                           ↓
                     Results & Reports
```

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: conventions -->
## Module-Specific Conventions

### Suite Definition (YAML)
```yaml
name: smoke
tasks:
  - name: simple-pr
    agent: pr-reviewer
    input:
      repo: org/test-repo
      pr_number: 1
    scorers:
      - type: schema
        schema: { type: object, required: [summary] }
      - type: security
        expect_no_violations: true
```

### Custom Scorers
```python
from fd_evals.scorers.base import Scorer, Score

class MyScorer(Scorer):
    def score(self, task: Task, result: RunResult) -> Score:
        return Score(value=1.0, reason="Passed")
```

### CLI Usage
```bash
fd-eval run --suite smoke
fd-eval report --latest
fd-eval replay --run-id run_xxx
```

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: dependencies -->
## Key Dependencies

| Package | Purpose |
|---------|---------|
| `httpx` | Gateway API calls |
| `pydantic` | Data validation |
| `typer` | CLI framework |
| `rich` | Terminal output |
| `pyyaml` | Suite config parsing |
| `jsonschema` | Schema validation scorer |

<!-- END AUTO-MANAGED -->

<!-- MANUAL -->
## Running Evaluations

```bash
# Smoke suite (quick)
make eval-run

# Full regression
make eval-run-full

# Generate HTML report
make eval-report
```

## Suite Configuration

Suites live in `evals/suites/`:
```
evals/
├── suites/
│   ├── smoke.yaml       # Quick sanity checks
│   └── regression.yaml  # Full test suite
├── datasets/            # Test data files
├── agents/              # Agent configs for evals
└── scorers/             # Custom scorer configs
```

## Adding New Scorers

1. Create scorer in `scorers/my_scorer.py`
2. Inherit from `Scorer` base class
3. Implement `score()` method
4. Register in `scorers/__init__.py`
5. Reference in suite YAML: `type: my_scorer`

<!-- END MANUAL -->
