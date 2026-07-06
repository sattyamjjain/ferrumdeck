# Enforcement decision-path latency

**What this answers:** *"If FerrumDeck sits in the call path and enforces on every
tool call, won't that slow my agent down?"* This is a reproducible
[criterion](https://github.com/bheisler/criterion.rs) microbenchmark of the
**governance decision itself** — the CPU cost of deciding *allow / deny / approve*
— so the overhead is a measured number, not a hand-wave.

> **Scope — read this first.** This measures the **decision path only**: the
> allowlist check, the Airlock RASP inspection, the R1–R3 reversibility ladder,
> and the EU AI Act Article 50 transparency rule. It **excludes** the database
> write of the audit event, the Redis queue hop, and — above all — the LLM call,
> which dominates real end-to-end run latency by three-to-six orders of
> magnitude. This is the *added CPU cost of the decision*, **not** end-to-end run
> latency, and it is **not** a "fastest"/"first" claim. The point is only that
> in-path governance is **sub-millisecond**, so enforcing in the request path is
> not what slows an agent down — the model is.

## Methodology

- **Harness:** `criterion` 0.5.1, `harness = false`, bench target
  [`rust/crates/fd-policy/benches/enforcement_latency.rs`](../../rust/crates/fd-policy/benches/enforcement_latency.rs).
- **What is timed:** each case constructs its `PolicyEngine` / `AirlockInspector`
  / config **once, outside** the timed loop, and only the decision call is
  measured; inputs are wrapped in `black_box` so the optimizer can't fold them
  away. No DB, no queue, no network, no LLM — pure decision CPU.
- **Airlock config:** enforce mode, anti-RCE matcher + data-exfiltration shield
  active; the stateful layers (velocity / schema-drift / behavioral-drift) are
  disabled so the figure is a per-call decision cost.
- **Percentiles:** `p50` / `p95` are the 50th / 95th percentiles of criterion's
  per-batch mean latencies over **100 samples** per case (the raw
  `target/criterion/<case>/new/sample.json`). criterion's own bootstrapped
  medians agree to within the same order of magnitude (see cross-check below).
- **Hardware / toolchain (this run):** Apple M4, macOS (Darwin arm64),
  `rustc 1.96.0 (ac68faa20 2026-05-25)`, `--release`.

Reproduce:

```bash
make bench-enforcement       # or: ./scripts/bench-enforcement.sh
```

Absolute numbers depend on hardware and machine load; reproduce locally for your
own environment. The **order of magnitude** (sub-µs to low-µs) is the point, not
the exact nanoseconds.

## Results

| Case | Layer | p50 (median) | p95 | samples |
|---|---|---|---|---|
| `allowlist_allow` | deny-by-default allowlist — allowed tool | **183 ns** | 192 ns | 100 |
| `allowlist_deny` | deny-by-default allowlist — fall-through deny | **84 ns** | 109 ns | 100 |
| `airlock_inspect_clean` | Airlock RASP — benign call (all patterns run) | **437 ns** | 503 ns | 100 |
| `airlock_inspect_blocked` | Airlock RASP — RCE payload blocked (early-exit) | **328 ns** | 348 ns | 100 |
| `reversibility_ladder` | R1–R3 reversibility ladder (R3) | **539 ps** | 626 ps | 100 |
| `art50_enforce` | EU AI Act Art. 50 transparency rule | **222 ns** | 257 ns | 100 |

Cross-check — criterion's own reported medians (with 95% CIs) for the same run:
`allowlist_allow` 184 ns [183, 185]; `allowlist_deny` 87 ns [85, 90];
`airlock_inspect_clean` 438 ns [431, 448]; `airlock_inspect_blocked`
333 ns [329, 340]; `reversibility_ladder` 565 ps [547, 590];
`art50_enforce` 229 ns [224, 235].

Note that the **blocked** Airlock case is *faster* than the clean one: a malicious
payload short-circuits the anti-RCE matcher on first hit, whereas a benign call
runs every pattern to completion. Every layer is well under a microsecond at both
p50 and p95; the whole decision stack — allowlist + Airlock + ladder + Art. 50 —
sums to **~1 µs at p50 and comfortably under 2 µs at p95**. (Absolute values
depend on machine load; an earlier run under heavier background load measured
2–5× these figures with wider p95 tails — the order of magnitude is stable, the
exact nanoseconds are not.)

## Interpretation

An LLM step in a real run costs hundreds of milliseconds to seconds. ~1 µs of
in-path governance is **~6 orders of magnitude smaller** than the model call it
gates — i.e. below the measurement noise of end-to-end run latency. So "enforce
in the call path" does not impose a latency tax you'd feel; the decision is
effectively free relative to the work it governs. That is the honest, narrow
claim this benchmark supports: **sub-millisecond in-path governance**, nothing
about being the fastest or first to do it.

## Further reading

- Guardrail latency-budget guidance for in-path agent governance —
  [arXiv:2603.20953](https://arxiv.org/abs/2603.20953). FerrumDeck's decision
  path sits comfortably inside a single-digit-microsecond budget, far under any
  human- or model-perceptible threshold.
