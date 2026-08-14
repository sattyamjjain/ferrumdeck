# Eval health

Generated from the report files in `evals/reports/` by `scripts/gen_eval_health.py`. Regenerated on every nightly `Evaluations` run; do not edit by hand.

FerrumDeck claims eval gating in CI. This page is the evidence for that claim. An eval that has never passed says so in its own row rather than being left out.

| Eval | Last run | Result | Score | Consecutive passes | Detail |
| --- | --- | --- | --- | --- | --- |
| `asb` | 2026-08-10 | pass | 1.00 | 6 | block 100%, benign utility 100% |
| `governed-benchmark` | 2026-08-10 | pass | 1.00 | 6 | governed blocked 100% vs ungoverned 0% |
| `injection_defense` | 2026-08-10 | pass | 1.00 | 7 | block 100%, benign utility 100% |
| `regression` | — | **NEVER RUN** | — | 0 | No report has ever been committed for this eval |
| `smoke` | — | **NEVER RUN** | — | 0 | No report has ever been committed for this eval |

## Evals with no passing run

- **`regression`** — LLM-backed safe-PR full regression. No report has ever been committed.
- **`smoke`** — LLM-backed safe-PR smoke suite (nightly). No report has ever been committed.

These are gaps in the eval-gating claim, not passing rows waiting to be filled in. Treat this section shrinking as the measure of progress.

## How a row is decided

| Report family | Counts as a pass when |
| --- | --- |
| `asb`, `injection_defense` | corpus parity holds, zero mismatches, and attack block rate is 100% |
| `governed-benchmark` | the governed run blocks 100% of unsafe actions |
| `eval_<suite>_<ts>` (LLM suites) | every task passed (`failed_tasks == 0`) |

_Generated 2026-08-14 08:08 UTC._
