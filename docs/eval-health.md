# Eval health

Generated from the report files in `evals/reports/` by `scripts/gen_eval_health.py`. Regenerated on every nightly `Evaluations` run; do not edit by hand.

This page is the current state. The **record** is [`eval-health-series.jsonl`](eval-health-series.jsonl): one append-only row per eval run, carrying the date, the commit that produced it, the numbers and the harness version. The page is regenerated and overwritten; the series is only ever appended to. If you need to show that a number existed on a given date rather than that it holds today, the series is the artifact — see [Recent measurements](#recent-measurements).

For whether a green row is *evidence about the agent* rather than the harness reporting on itself, see [`docs/eval-verdicts.md`](eval-verdicts.md), which carries one verdict per eval. This page answers *did it pass*; that one answers *does the pass mean anything*.

FerrumDeck claims eval gating in CI. This page is the evidence for that claim. An eval that has never passed says so in its own row rather than being left out.

## What the safe-PR numbers mean

The safe-PR eval was never measuring the safe-PR agent. Its dataset (`evals/datasets/safe-pr-agent/tasks.jsonl`) expects software-engineering artifacts -- files changed, a pull request opened, tests passing -- against `example/project`, a repository that does not exist. This control plane runs a model through a policy decision path; it never clones a repository, runs a test, or opens a pull request. Those expectations were unsatisfiable by construction on the day the dataset was written, so the eval was measuring something the agent was never built to do.

That has now shown up twice, in opposite directions, because the harness kept describing itself instead of the agent. It first read as 0% ([#31](https://github.com/sattyamjjain/ferrumdeck/issues/31)), when the suite's declared scorers were discarded and substituted ones scored against run fields the runner never populates. It then read as a clean 1.00, because the substituted scorers were replaced with declared ones that mostly skip -- and a skip returned a full score.

Assertion coverage is the number that makes a score readable. On the most recent committed run of each suite it stands at `regression` at 100%, `smoke` at 100%. Coverage is the share of scorer results that asserted anything at all; the remainder returned a full score for having nothing to check, so those scores are an average over the covered fraction only. Runs from before the suites were rescoped will keep showing the coverage they were actually measured at -- this page reports what happened, not what the configuration would do today.

So neither number was ever evidence about the agent. The response is to rescope rather than to tune: the suites now assert what this control plane can genuinely observe -- policy decisions, budget compliance, and output text -- and `fd_evals` reports which dataset expectations no scorer reads, so an eval that quietly stops testing its own dataset says so instead of averaging its way to a number. There is still no measurement of whether the agent writes good pull requests, and this page should not be read as claiming otherwise.

| Eval | Last run | Result | Score | Consecutive passes | Detail |
| --- | --- | --- | --- | --- | --- |
| `asb` | 2026-08-30 | pass | 1.00 | 4 | block 100%, benign utility 100% |
| `coherence_fp` | 2026-09-02 | pass | 0.90 | 1 | false-positive rate 10.42% (25/240), Wilson 95% CI [7.16%, 14.92%]; 0 trace(s) from a real agent run |
| `governed-benchmark` | 2026-08-30 | pass | 1.00 | 4 | governed blocked 100% vs ungoverned 0% |
| `injection_defense` | 2026-08-30 | pass | 1.00 | 4 | block 100%, benign utility 100% |
| `regression` | 2026-08-30 | pass | 1.00 | 4 | 20/20 tasks passed, avg score 1.00, assertion coverage 100% |
| `smoke` | 2026-09-06 | pass | 1.00 | 24 | 3/3 tasks passed, avg score 1.00, assertion coverage 100% |

## Recent measurements

The last 20 of 41 rows from [`eval-health-series.jsonl`](eval-health-series.jsonl), newest first. The table above says what is true today; this says what was true before, which is the part a snapshot throws away. **A number that has never moved here has not been re-measured** — check `measured` against `recorded` before reading a steady value as a stable one.

| Measured | Recorded | Suite | Result | Score | Harness | Detail |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-09-06 | 2026-09-06 | `smoke` | pass | 1.00 | 0.8.18 | 3/3 tasks passed, avg score 1.00, assertion coverage 100% |
| 2026-09-05 | 2026-09-05 | `smoke` | pass | 1.00 | 0.8.17 | 3/3 tasks passed, avg score 1.00, assertion coverage 100% |
| 2026-09-04 | 2026-09-04 | `smoke` | pass | 1.00 | 0.8.17 | 3/3 tasks passed, avg score 1.00, assertion coverage 100% |
| 2026-09-03 | 2026-09-03 | `smoke` | pass | 1.00 | 0.8.17 | 3/3 tasks passed, avg score 1.00, assertion coverage 100% |
| 2026-09-02 | 2026-09-02 | `coherence_fp` | pass | 0.90 | 0.8.17 | false-positive rate 10.42% (25/240), Wilson 95% CI [7.16%, 14.92%]; 0 trace(s) from a real agent run |
| 2026-09-02 | 2026-09-02 | `smoke` | pass | 1.00 | 0.8.16 | 3/3 tasks passed, avg score 1.00, assertion coverage 100% |
| 2026-09-01 | 2026-09-01 | `smoke` | pass (backfilled) | 1.00 | 0.8.16 | 3/3 tasks passed, avg score 1.00, assertion coverage 100% |
| 2026-08-31 | 2026-09-01 | `smoke` | pass (backfilled) | 1.00 | 0.8.15 | 3/3 tasks passed, avg score 1.00, assertion coverage 100% |
| 2026-08-30 | 2026-09-01 | `regression` | pass (backfilled) | 1.00 | 0.8.15 | 20/20 tasks passed, avg score 1.00, assertion coverage 100% |
| 2026-08-30 | 2026-09-01 | `smoke` | pass (backfilled) | 1.00 | 0.8.15 | 3/3 tasks passed, avg score 1.00, assertion coverage 100% |
| 2026-08-30 | 2026-09-01 | `injection_defense` | pass (backfilled) | 1.00 | 0.8.15 | block 100%, benign utility 100% |
| 2026-08-30 | 2026-09-01 | `governed-benchmark` | pass (backfilled) | 1.00 | 0.8.15 | governed blocked 100% vs ungoverned 0% |
| 2026-08-30 | 2026-09-01 | `asb` | pass (backfilled) | 1.00 | 0.8.15 | block 100%, benign utility 100% |
| 2026-08-29 | 2026-09-01 | `smoke` | pass (backfilled) | 1.00 | 0.8.15 | 3/3 tasks passed, avg score 1.00, assertion coverage 100% |
| 2026-08-28 | 2026-09-01 | `smoke` | pass (backfilled) | 1.00 | 0.8.15 | 3/3 tasks passed, avg score 1.00, assertion coverage 100% |
| 2026-08-27 | 2026-09-01 | `smoke` | pass (backfilled) | 1.00 | 0.8.15 | 3/3 tasks passed, avg score 1.00, assertion coverage 100% |
| 2026-08-26 | 2026-09-01 | `smoke` | pass (backfilled) | 1.00 | 0.8.14 | 3/3 tasks passed, avg score 1.00, assertion coverage 100% |
| 2026-08-26 | 2026-09-01 | `injection_defense` | pass (backfilled) | 1.00 | 0.8.15 | block 100%, benign utility 100% |
| 2026-08-26 | 2026-09-01 | `governed-benchmark` | pass (backfilled) | 1.00 | 0.8.15 | governed blocked 100% vs ungoverned 0% |
| 2026-08-26 | 2026-09-01 | `asb` | pass (backfilled) | 1.00 | 0.8.15 | block 100%, benign utility 100% |

The file is append-only and never rewritten by the refresh job. A row found to be wrong is corrected by appending a row carrying `correction_of` and `reason`; the original stays, because the fact that it was published is part of the record. `--check-series` enforces that the committed file remains a prefix of the working one.

## How a row is decided

| Report family | Counts as a pass when |
| --- | --- |
| `asb`, `injection_defense` | corpus parity holds, zero mismatches, and attack block rate is 100% |
| `governed-benchmark` | the governed run blocks 100% of unsafe actions |
| `eval_<suite>_<ts>` (LLM suites) | every task passed (`failed_tasks == 0`) |

_Generated 2026-09-06 06:58 UTC._
