# ferrumdeck-policy

The **enforcement engine** of [**FerrumDeck**](https://github.com/sattyamjjain/ferrumdeck) —
a deterministic, in-path governance layer for AI agents. It returns an
`allow` / `deny` / `requires-approval` decision *before* a tool call executes,
rather than charting it after the fact. The decision path is sub-millisecond
(see [`docs/benchmarks/enforcement-latency.md`](https://github.com/sattyamjjain/ferrumdeck/blob/main/docs/benchmarks/enforcement-latency.md)).

What's in the box:

- **Deny-by-default tool allowlist** — `PolicyEngine` / `ToolAllowlist`.
- **Airlock RASP** — per-call anti-RCE matcher + data-exfiltration shield
  (`AirlockInspector`, shadow/enforce modes).
- **R1–R3 reversibility ladder** — graduated response mapped onto the DeepMind
  AI Control Roadmap tiers (`graduated_response`, `ResponseLevel`).
- **EU AI Act Article 50 transparency rule** — `check`/`enforce` for
  AI-disclosure + machine-readable marking.

Published as `ferrumdeck-policy`; the **Rust import path is `fd_policy`**:

```toml
[dependencies]
ferrumdeck-policy = "0.7"
```

```rust
use fd_policy::{PolicyEngine, ToolAllowlist};

let engine = PolicyEngine::default();
let allowlist = ToolAllowlist {
    allowed_tools: vec!["read_file".into()],
    approval_required: vec![],
    denied_tools: vec!["delete_repo".into()],
};
// Deny-by-default: only allowlisted tools pass.
assert!(engine.evaluate_tool_call_with(&allowlist, "read_file").is_allowed());
assert!(engine.evaluate_tool_call_with(&allowlist, "delete_repo").is_denied());
assert!(engine.evaluate_tool_call_with(&allowlist, "unknown").is_denied());
```

Prefer a single dependency? The [`ferrumdeck`](https://crates.io/crates/ferrumdeck)
umbrella crate re-exports this engine.

Licensed under Apache-2.0. Source + full control plane:
<https://github.com/sattyamjjain/ferrumdeck>.
