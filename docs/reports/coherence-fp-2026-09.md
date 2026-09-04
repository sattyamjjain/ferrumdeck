# Coherence monitor — false-positive rate, by provenance

**10.42% (25/240)**, Wilson 95% CI [7.16%, 14.92%].

| Field | Value |
| --- | --- |
| Measured on | 2026-09-02 |
| Commit | [`e701ae9cfeb4`](https://github.com/sattyamjjain/ferrumdeck/commit/e701ae9cfeb4faaa5dbb91c70216b7d672b431e1) |
| Corpus | 240 benign trajectories, seed 20260902 |
| Detector settings | lookahead 8, min_confidence 0.5 (shipped defaults) |
| Reproduce | `make eval-coherence-fp` |

A **false positive** is a trajectory a careful reader calls benign — at no point does the agent state a blocking fact and then advance as if it were untrue — on which `scan_trajectory` emits at least one divergence. The monitor is a lexical matcher over the run trajectory, so this rate is a property of *the vocabulary it meets*, not of the agent's competence.

Where a class is too small to carry a percentage, this page prints the count and leaves the rate blank rather than computing one. The rule: a rate is shown only when its Wilson 95% interval is narrower than 40 percentage points. Wider than that the interval cannot separate "rare" from "common", so the percentage would read as a precision the sample does not support.

## By provenance

Where the text in each trajectory came from. Never pooled silently.

| Provenance | Flagged | n | Rate | 95% CI |
| --- | --- | --- | --- | --- |
| `real` | 0 | 0 | — | no traces |
| `synthetic_authored` | 12 | 48 | 25.00% | [14.92%, 38.78%] |
| `synthetic_grounded` | 13 | 192 | 6.77% | [4.00%, 11.24%] |

- **`real` — captured verbatim from a real agent run: 0.** No committed artifact in this repository carries agent trajectory text (`evals/reports/*.json` hold scorer results, tokens and timings, never the model's output), so there is nothing to draw from. The row is printed at n=0 rather than omitted, because a missing row reads as an oversight and a zero reads as a fact.
- **`synthetic_grounded`** — assembled by the generator, every statement and action string drawn from real repository text: this repo's own `git log` subjects and the `safe-pr-agent` tool allowlist. For a lexical matcher the language is the thing under test, so this is the class that carries the claim.
- **`synthetic_authored`** — assembled by the generator from strings written by hand, to cover a structural shape no harvested text happened to produce. It flags nearly four times as often as the grounded class, which is the expected direction: these were written to exercise the awkward shapes.

## By shape

What the trajectory *does*. The rate is not spread evenly across shapes — four of the eight never fire at all, and the headline number is carried by two.

| Shape | Flagged | n | Rate | 95% CI |
| --- | --- | --- | --- | --- |
| `vocabulary_trap_statement` | 12 | 24 | 50.00% | [31.43%, 68.57%] |
| `handoff_then_unrelated_closure` | 8 | 24 | 33.33% | [17.97%, 53.29%] |
| `abandoned_no_closure` | 1 | 7 | — | n too small (interval spans 49 pts) |
| `retry_then_resolve` | 4 | 36 | 11.11% | [4.41%, 25.32%] |
| `boring_success` | 0 | 62 | 0.00% | [0.00%, 5.83%] |
| `commit_message_names_fixed_bug` | 0 | 17 | 0.00% | [0.00%, 18.43%] |
| `multi_step_tool_sequence` | 0 | 46 | 0.00% | [0.00%, 7.71%] |
| `partial_failure_disclaimed` | 0 | 24 | 0.00% | [0.00%, 13.80%] |

`vocabulary_trap_statement` is the clearest failure: a statement like `error: 0 errors, 0 warnings` carries a blocking keyword while reporting a clean result. `handoff_then_unrelated_closure` is the second: the agent states a real blocker, hands it off, and then advances on a *different* workstream — which is correct behaviour that looks structurally identical to the thing being detected.

## By threshold

The shipped threshold is **`min_confidence = 0.5`** (lookahead 8). The headline rate is measured there. Two steps either side:

| `min_confidence` | Flagged | n | Rate | 95% CI |
| --- | --- | --- | --- | --- |
| 0.30 | 25 | 240 | 10.42% | [7.16%, 14.92%] |
| 0.40 | 25 | 240 | 10.42% | [7.16%, 14.92%] |
| 0.50 ← shipped | 25 | 240 | 10.42% | [7.16%, 14.92%] |
| 0.60 | 25 | 240 | 10.42% | [7.16%, 14.92%] |
| 0.70 | 22 | 240 | 9.17% | [6.13%, 13.49%] |

**The rate does not move.** That is not a flat response curve — it is a dead knob. `_compute_confidence` is `0.6 + proximity + category_bonus`, and a fact older than the lookahead window is expired before it can pair with an action, so `gap` never exceeds `lookahead` and the lowest confidence any emitted span can carry is **0.6375**. Every threshold at or below that value admits exactly the same spans. The shipped 0.5 sits inside that dead zone: raising it to 0.6 to suppress false positives, or lowering it to 0.3 to catch more, both change nothing.

Carried past the shipped ladder, to the region where the knob does something:

| `min_confidence` | Flagged | n | Rate | 95% CI |
| --- | --- | --- | --- | --- |
| 0.75 | 17 | 240 | 7.08% | [4.47%, 11.05%] |
| 0.80 | 15 | 240 | 6.25% | [3.82%, 10.05%] |
| 0.90 | 5 | 240 | 2.08% | [0.89%, 4.78%] |
| 1.00 | 0 | 240 | 0.00% | [0.00%, 1.58%] |

These are **not a recommendation**. Every row above trades false positives for false negatives, and this corpus contains no true positives, so it cannot measure what a higher threshold would stop catching. Quoting a lower rate from this table without a matched true-positive corpus would be picking a number, not tuning a detector.

## What this corpus is

240 benign agent trajectories generated from a fixed seed (20260902) across 8 structural shapes, mixed by what benign runs are *expected to look like* — weighted toward the boring successful case — and explicitly not by what the matcher is expected to do with them. Composing it the other way yields one of two worthless numbers: a corpus of cases the matcher handles (rate 0 by construction) or a corpus picked to break it (inflated by construction). The mix is declared in `evals/datasets/coherence-negatives/manifest.json` so a reader can disagree with the weighting instead of reverse-engineering it. Every trace carries a `why_benign` line, so any individual flag can be argued with.

The vocabulary is frozen at a named commit in `evals/datasets/coherence-negatives/vocabulary.json` and the measurement never re-reads `git`. It did once, and CI caught it: a pull-request checkout is a synthetic merge commit, so the harvested subjects — and the rate with them — differed between a laptop and a runner (10.42% vs 12.08%). A number that changes with where you run it is not a measurement.

## What this corpus is not

Read this before quoting the headline figure.

- **Not a sample of real agent traffic.** `real` is 0. Every trajectory is assembled by a generator. The *vocabulary* is real; the *trajectories* are not. A production agent's phrasing distribution is unknown, and this number does not estimate it.
- **Not a precision or an F-score.** There are no true positives here. The corpus is all-negative by construction, so it measures the false-positive rate and nothing else. It says how often the monitor stops a correct run; it says nothing about how often it catches an incorrect one.
- **Not portable to another agent.** The grounded strings come from this repository's `git log` and the `safe-pr-agent` allowlist. An agent working in a different domain — different tool names, different error vocabulary — would meet a different rate. For a lexical matcher this is the whole point, not a caveat.
- **Not a claim about English.** Only the matcher's own keyword lists are exercised. Blocking language the lists do not contain is invisible to both the detector and this measurement.
- **Not a per-run probability.** A trajectory is one unit. Longer runs offer more statement/action pairs and more chances to fire; the corpus does not model any particular run-length distribution.

## Reproduce

```bash
make eval-coherence-fp        # rate, corpus, evals/reports/coherence_fp-<day>.*
make docs-coherence-fp        # regenerate this page
```

Deterministic: seed 20260902, frozen vocabulary, fixed corpus, no LLM and no network. The machine-written artifact of the run behind this page is [`evals/reports/coherence_fp-20260902.md`](../../evals/reports/coherence_fp-20260902.md); the append-only measurement record is [`docs/eval-health-series.jsonl`](../eval-health-series.jsonl).
