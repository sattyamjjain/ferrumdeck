# ferrumdeck

A deterministic, in-path **enforcement engine** for AI agents. FerrumDeck sits in
the tool-call path and returns an `allow` / `deny` / `requires-approval` decision
*before* the agent acts — it blocks the call, it doesn't just chart it after the
fact. The decision path is sub-millisecond
([benchmark](https://github.com/sattyamjjain/ferrumdeck/blob/main/docs/benchmarks/enforcement-latency.md)).

This is the **umbrella crate**: it re-exports the enforcement decision path from
[`ferrumdeck-policy`](https://crates.io/crates/ferrumdeck-policy) so one
dependency gets you the engine.

```toml
[dependencies]
ferrumdeck = "0.8"
```

```rust
use ferrumdeck::{PolicyEngine, ToolAllowlist};

let engine = PolicyEngine::default();
let allowlist = ToolAllowlist {
    allowed_tools: vec!["read_file".into()],
    approval_required: vec![],
    denied_tools: vec!["delete_repo".into()],
};
assert!(engine.evaluate_tool_call_with(&allowlist, "read_file").is_allowed());
assert!(engine.evaluate_tool_call_with(&allowlist, "delete_repo").is_denied());
assert!(engine.evaluate_tool_call_with(&allowlist, "unknown").is_denied());
```

What's inside (from `ferrumdeck-policy`): deny-by-default tool allowlists, Airlock
RASP (anti-RCE + data-exfiltration, shadow/enforce), the R1–R3 reversibility
ladder, budget gates, and an EU AI Act Article 50 transparency rule.

Need the tamper-evident audit trail (append-only hash-chain + signed chain-head
checkpoints)? It's an **optional feature** — `cargo add ferrumdeck --features audit`,
reached at `ferrumdeck::audit` (e.g. `ferrumdeck::audit::CheckpointSigner`). Off by
default so the base install stays the lean enforcement engine.

Prefer the pieces directly? `ferrumdeck-policy` (the engine) and `ferrumdeck-core`
(primitives) are published separately.

Licensed under Apache-2.0. Full control plane, dashboard, and evals:
<https://github.com/sattyamjjain/ferrumdeck>.
