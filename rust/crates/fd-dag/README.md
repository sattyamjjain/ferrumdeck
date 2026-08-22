# ferrumdeck-dag

The DAG scheduler from [**FerrumDeck**](https://github.com/sattyamjjain/ferrumdeck) —
a deterministic, in-path **enforcement engine** for AI agents.

A small, dependency-light scheduler for workflows whose steps declare
dependencies: it resolves execution order, detects cycles, and yields the set of
steps that are ready to run at each stage so a caller can execute them
concurrently.

Published as `ferrumdeck-dag`; the **Rust import path is `fd_dag`**:

```toml
[dependencies]
ferrumdeck-dag = "0.8"
```

**Scope.** This crate is the ordering primitive only. It executes nothing,
enforces nothing, and knows nothing about agents or policy — the enforcement
decisions live in [`ferrumdeck-policy`](https://crates.io/crates/ferrumdeck-policy).
Useful on its own if you want dependency-ordered scheduling without adopting the
rest of FerrumDeck.

Apache-2.0.
