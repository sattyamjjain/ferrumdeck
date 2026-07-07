# ferrumdeck-core

Core primitives for [**FerrumDeck**](https://github.com/sattyamjjain/ferrumdeck) —
a deterministic, in-path **enforcement engine** for AI agents. This crate holds
the foundation types shared across the FerrumDeck control plane: ULID-based typed
IDs (`RunId`, `StepId`, `AgentId`, … via the `define_id!` macro), common error
types, configuration loading, and time helpers. Zero business logic.

It is published as `ferrumdeck-core` (the plain `fd-core` name is taken on
crates.io by an unrelated crate), but the **Rust import path is `fd_core`**:

```toml
[dependencies]
ferrumdeck-core = "0.7"
```

```rust
use fd_core::define_id;

define_id!(WorkflowId, "wfl");
let id = WorkflowId::new(); // wfl_01HGXK3R5N...
```

Most users want the enforcement engine itself — see
[`ferrumdeck-policy`](https://crates.io/crates/ferrumdeck-policy) or the
[`ferrumdeck`](https://crates.io/crates/ferrumdeck) umbrella crate.

Licensed under Apache-2.0. Source, docs, and the full control plane live at
<https://github.com/sattyamjjain/ferrumdeck>.
