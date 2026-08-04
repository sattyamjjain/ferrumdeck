# ferrumdeck-audit

The **audit trail** of [**FerrumDeck**](https://github.com/sattyamjjain/ferrumdeck) —
an append-only, tamper-*evident* record of every governed action, for compliance
and forensics. Motivated by **EU AI Act Art. 12/19** record-keeping (applicable
2026-08-02) and **Colorado SB 26-189**'s 3-year retention floor (from 2027-01-01).

What's in the box:

- **Append-only event trail** with built-in PII redaction (`redaction`).
- **Per-tenant SHA-256 hash-chain** (`chain`) — each record commits to its
  predecessor over a canonical, key-sorted encoding, so any insertion, deletion,
  or in-place edit *within* a chain is detectable by `verify_chain`.
- **Signed out-of-band chain-head checkpoints** (`checkpoint`) — the piece that
  catches a *wholesale self-consistent tail rewrite*, which the chain alone
  cannot. `CheckpointSigner` signs a `(tenant_id, chain_seq, record_hash,
  checkpointed_at)` head record with an **Ed25519 key that is not the
  database's**, `FileCheckpointSink` appends it to an out-of-band sink (behind a
  `CheckpointSink` trait), and `verify_against_checkpoints` proves the chain has
  not been rewritten past the most recent checkpoint.

**The guarantee, stated exactly:** tampering is detectable **up to the most
recent checkpoint**; records after it keep the in-chain guarantee, a missing
checkpoint degrades to it (and says so), and this is *detection, not
prevention* — **not tamper-proof**, and only as strong as an out-of-band sink +
off-host key.

Published as `ferrumdeck-audit`; the **Rust import path is `fd_audit`**:

```toml
[dependencies]
ferrumdeck-audit = "0.8"
```

```rust
use fd_audit::{verify_chain, verify_against_checkpoints, CheckpointSigner};
```

Apache-2.0. Part of the FerrumDeck workspace — see the
[repository](https://github.com/sattyamjjain/ferrumdeck) for the full control
plane, data plane, and dashboard.
