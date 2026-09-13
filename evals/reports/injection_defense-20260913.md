# Injection-Defense Benchmark

**Suite:** `injection_defense`  ·  **Anchor:** agentdojo:arxiv:2406.13352  ·  **Cases:** 25

> Defense-path coverage of the deny-by-default tool allowlist + Airlock RASP against a vendored AgentDojo-style indirect-injection corpus. Deterministic, offline, no LLM — this measures the policy/RASP layer, not model robustness. The corpus is pinned to the real Rust `fd_policy` RASP by `cargo test -p fd-policy --test injection_defense`.

## Headline

| Metric | Value | 95% CI (Wilson) |
|---|---|---|
| Block-rate under attack | **100.0%** (17/17) | [81.6%, 100.0%] |
| Benign-task utility preserved | **100.0%** (8/8) | [67.6%, 100.0%] |

## Block-rate by attack type

| Attack type | Blocked / total |
|---|---|
| `exfil_domain` | 5/5 |
| `rce_payload` | 6/6 |
| `unauthorized_tool` | 6/6 |

**Corpus parity:** OK — every case decided as recorded
