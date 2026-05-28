# fd-evals

FerrumDeck Evaluation Framework - Deterministic eval harness for agent workflows.

## Features

- **Deterministic Scorers**: Test pass/fail, schema validation, file changes, PR creation
- **Eval Runner**: Execute tasks against agents and collect metrics
- **Regression Reports**: Compare runs to detect performance regressions
- **Bench-Audit Pre-Flight**: ABA-style hygiene audit ([arXiv:2605.26079][aba]) — score a suite's task metadata + grader config *before* a benchmark delta is allowed to gate routing
- **CLI Interface**: Easy-to-use command line tool

[aba]: https://arxiv.org/abs/2605.26079

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

### Auditing benchmarks before they gate routing

Eval suites used to justify a routing / model-swap decision (e.g. "model B beats
model A by +3% on suite X, so route to B") must pass a deterministic hygiene
audit first — otherwise the cited delta could be an artefact of ambiguous tasks,
brittle grading, or suspect ground truth rather than a real capability
difference. The audit is anchored on **ABA** (*Are Benchmarks Aware?*,
[arXiv:2605.26079][aba]) and scores four classes per task:

| Class                 | Detects                                                          |
| --------------------- | ---------------------------------------------------------------- |
| `ambiguous_spec`      | under-specified task spec, vague pronouns, unresolved placeholders |
| `env_conflict`        | undeclared env vars, empty `repo`/`branch`, hidden execution deps  |
| `brittle_grading`     | orphan expected keys, conflicting graders (regex + contains)      |
| `suspect_truth`       | missing/empty ground truth, wildcard paths, duplicate task ids    |

The output `bench_trust_score ∈ [0, 1]` and the list of flagged task ids are
denormalised onto each `EvalRun`. The Rust policy plane
(`fd_policy::bench_audit`) consults this summary and emits standard
[`PolicyVerdict`][verdict]s — `bench_audit:low_trust_score` (Deny),
`bench_audit:hitl_band` (RequiresApproval),
`bench_audit:within_flagged_margin` (Deny when the cited delta is inside the
flagged-task noise floor), `bench_audit:high_trust_score` (Allow) — which flow
through the same `resolve_conflicts` precedence resolver and `DecisionTrace`
used by the allowlist + budget tiers. Deny-by-default is preserved at the
caller.

The check is **purely deterministic** — no LLM judge is consulted, so the same
suite produces the same `bench_trust_score` on every CI run.

Run it standalone:

```bash
# Audit a named suite (resolves the dataset via evals/suites/<name>.yaml)
fd-eval audit --suite smoke

# Or audit a JSONL dataset directly
fd-eval audit --dataset evals/datasets/safe-pr-agent/tasks.jsonl \
    --output evals/reports/bench_audit_safe-pr-agent.json

# CI gate: fail when trust drops below 0.70 (the Rust default)
fd-eval audit --suite regression --min-trust 0.70
```

[aba]: https://arxiv.org/abs/2605.26079
[verdict]: ../../rust/crates/fd-policy/src/precedence.rs

## Scorers

- `TestPassScorer`: Checks if tests pass
- `FilesChangedScorer`: Verifies expected files were modified
- `PRCreatedScorer`: Confirms PR was created
- `LintScorer`: Checks linting results
- `SchemaScorer`: Validates output against JSON schema
- `CompositeScorer`: Combines multiple scorers with weights

## License

MIT
