# Eval verdicts: harness, real zero, or wrong question

One row per eval. For each, whether its score is evidence about the agent, and
what that judgement rests on.

`docs/eval-health.md` answers *did it pass*. This page answers *does the pass
mean anything*, which is the question the 0.8.7 investigation (#31) showed is
not the same one. It is written by hand and reviewed when an eval is added or
rescoped; it is not generated, because a verdict is a judgement about evidence
rather than a projection of it.

## The premise, first

**No eval in this repository is currently failing.** `docs/eval-health.md`
reports five evals, all passing, none without a passing run. So "why is this
eval failing" has an empty subject, and answering it as asked would have
invented one.

The question that does have a subject is the inverse: four of those five green
rows were, at least in part, the harness reporting on itself. That is what the
table records.

## Verdicts

| Eval | Verdict | Evidence | Identifier |
| --- | --- | --- | --- |
| `smoke` | **Harness, both directions** — never a real zero, and the 1.00 was half unearned | 3 of 6 scorer results vacuous on **every** committed run. Recomputed from committed reports alone, no LLM and no stack | `eval_b79741a3b76f`, `eval_ded3c264045d`, `eval_f72a74e9b76f`, `eval_37f775526af0` |
| `regression` | **Harness, both directions** — same defect at full dataset size | 40 of 80 scorer results vacuous on every committed run | `eval_27bd19443ba1`, `eval_63f4029ec890` |
| `asb` | **Real pass** | Deterministic, seeded, offline. Never calls `load_suite`, so the discarded-scorer defect cannot reach it | `evals/reports/asb-20260810.json` |
| `injection_defense` | **Real pass** | Same: separate `@app.command`, no suite loading, no `run_context` dependency | `evals/reports/injection_defense-20260810.json` |
| `governed-benchmark` | **Real pass** | Same | `evals/reports/governed-benchmark-20260810.json` |

Vacuous means the scorer returned a full score for having nothing to check —
`SchemaScorer` on a task declaring no `output_schema`, `ExpectedOutputMatch` on
a task declaring no output expectations. `CompositeScorer` folded
`score * weight` for those exactly as it did for earned passes, so a skip at
1.0 and a genuine pass were arithmetically indistinguishable.

Reproduce the ratio:

```bash
python3 - <<'PY'
import json, subprocess
V = ("no schema validation required", "no output expectations declared")
for p in subprocess.run(["git","ls-files","evals/reports/"],
                        capture_output=True, text=True).stdout.split():
    d = json.load(open(p)) if p.endswith(".json") else {}
    r = [s for t in d.get("results", []) for s in (t.get("scorer_results") or [])]
    if r:
        vac = sum(1 for s in r
                  if s.get("skipped") or any(v in (s.get("message") or "").lower() for v in V))
        print(f"{p.split('/')[-1]:44} {len(r):3} results, {vac:3} vacuous")
PY
```

## Why the two LLM suites, and not the other three

The defect fixed in 0.8.7 had one entry point: `fd_evals.cli.get_default_scorers()`
was used for every run, so the `scorers:` and `filter:` blocks in
`evals/suites/*.yaml` were parsed and thrown away, and three of the four
substituted scorers read `run_context` keys only `_execute_mock_run()` ever
populates.

That path is `fd_evals run --suite …`, which calls `load_suite`. Checked
against the tree at the time of writing, `load_suite` is called from exactly one
place (`cli.py`, inside `run_eval`). `asb`, `injection-defense`,
`governed-benchmark` and `enforce-vs-observe` are separate `@app.command`
entry points that never call it and never build a `run_context`. The defect is
structurally unreachable from them — not merely absent today.

So the split above is not a survey of which evals happened to be affected. It
is the boundary of the one code path that could be.

## Residual risk

`get_default_scorers()` still exists and is still reachable. It is now a guarded
fallback rather than an unconditional substitution: a suite's own scorers win
when it declares any, and the fallback prints a warning naming itself. But two
ways in remain.

- A bare dataset run (`fd_evals run <path>` with no `--suite`) still gets the
  four default scorers.
- A suite that declares an empty `scorers:` block falls back to them.

On the safe-PR dataset both cases score a genuine 0, not a skip:
`FilesChangedScorer` skips only when the *task* declares no `files_changed`, and
every task in that dataset declares one. So the run reports 0.0 for a reason
that has nothing to do with the agent.

The warning is printed. Nothing fails. If this recurs, that is where to look
first.

## What no eval here measures

None of these measure whether the agent writes good pull requests.
`evals/datasets/safe-pr-agent/tasks.jsonl` expects files changed, a PR opened
and tests passing against `example/project` — a repository that does not exist
and that this control plane never clones. Those expectations were unsatisfiable
on the day the dataset was written.

The suites were rescoped to assert what the control plane can actually observe
(governance path, budget compliance, output non-degeneracy) rather than tuned
to make the old assertions pass. `LoadedSuite.unasserted_expectations()` names
the dataset keys no declared scorer reads, and the runner prints them before
every run, so the next dataset that quietly stops being tested says so instead
of averaging past it.

## Maintaining this page

Add a row when an eval is added. Revisit a row when a suite is rescoped, when a
scorer changes what it reads, or when `load_suite` gains a second caller — that
last one widens the blast radius of the defect above, and this page is where
that should be noticed.
