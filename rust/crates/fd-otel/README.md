# ferrumdeck-otel

OpenTelemetry helpers for [**FerrumDeck**](https://github.com/sattyamjjain/ferrumdeck) —
a deterministic, in-path **enforcement engine** for AI agents.

This is the crate the OTel claims in FerrumDeck's README actually rest on, so it
is published rather than left workspace-internal: a span contract nobody outside
the repository can inspect is a claim taken on trust.

It provides:

- **GenAI semantic conventions** (`fd_otel::genai`) with the
  `OTEL_SEMCONV_STABILITY_OPT_IN` flip, so span names and attributes track the
  evolving spec instead of freezing at one draft.
- **Enforcement-decision spans** (`fd_otel::decision`) — every allow / deny /
  approval emitted as a span with stable `ferrumdeck.*` attributes
  (`decision`, `reason`, `response_level`, `budget_remaining`), so an
  enforcement outcome is queryable in a tracing backend and not only in a log.
- **Cost decomposition** and **firing-rate** attributes for spend and
  control-firing analysis.
- **W3C trace-context extraction** from MCP request `_meta` (SEP-414), so a tool
  call joins the caller's distributed trace.

Published as `ferrumdeck-otel`; the **Rust import path is `fd_otel`**:

```toml
[dependencies]
ferrumdeck-otel = "0.8"
```

```rust
use fd_otel::GenAiSemconv;

let semconv = GenAiSemconv::from_env();
if semconv.is_latest_experimental() {
    // span naming follows the newer GenAI convention
}
```

**Scope, stated plainly.** This crate emits spans that *follow* the OTel GenAI
conventions; it does not claim conformance to them. The mapped-versus-unmapped
field counts, and that disclaimer, are generated into
[`docs/otel-genai-mapping.md`](https://github.com/sattyamjjain/ferrumdeck/blob/main/docs/otel-genai-mapping.md).

Apache-2.0.
