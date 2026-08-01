# MCP distributed-trace context (SEP-414) in FerrumDeck

**What this answers:** *"When my host app and MCP client already emit an
OpenTelemetry trace, does ferrumdeck's enforcement decision show up in the same
trace, or does it start a disconnected one?"* As of this version, when the
caller propagates W3C trace context in the MCP request `_meta`, ferrumdeck parents
its enforcement decision span on that context, so the decision joins your trace
instead of orphaning a new one.

> **Status honesty — read first.** ferrumdeck **implements the SEP-414 `_meta`
> trace-context conventions and targets the MCP 2026-07-28 revision**. That
> revision is now the **current, ratified** MCP specification — it is no longer a
> Release Candidate: the `2026-07-28` GitHub release is `prerelease: false`
> (published 2026-07-28), and <https://modelcontextprotocol.io/specification/latest>
> 307-redirects to `/specification/2026-07-28`, which
> [states](https://modelcontextprotocol.io/specification/versioning) "The current
> protocol version is 2026-07-28" (verified live 2026-08-01). SEP-414's
> conventions **survived ratification unchanged** — the ratified reserved-key
> table ([basic/index](https://modelcontextprotocol.io/specification/2026-07-28/basic/index))
> keeps `traceparent` / `tracestate` / `baggage` as the **unprefixed** exceptions
> reserved for OpenTelemetry — so this implementation is *more* defensible now,
> not less. SEP-414's own status is *Final / Standards Track*.
>
> This page still says ferrumdeck **implements / targets** those conventions and
> deliberately does **not** claim "conformance" — on its one real remaining
> ground: **no MCP conformance suite has been run against ferrumdeck.** Update
> this wording to "conformant to MCP 2026-07-28" only once such a suite has
> actually been run and passed.

## What SEP-414 specifies

SEP-414 reserves three **unprefixed** `_meta` keys — an exception to MCP's usual
DNS-prefix rule — so existing OpenTelemetry propagation works unchanged. Quoting
the specification verbatim
([modelcontextprotocol.io/seps/414-request-meta](https://modelcontextprotocol.io/seps/414-request-meta)):

> "When OTel trace context is propagated via `_meta`, the keys `traceparent`,
> `tracestate`, and `baggage` follow [W3C Trace Context](https://www.w3.org/TR/trace-context/)
> and [W3C Baggage](https://www.w3.org/TR/baggage/) value formats."

The SEP's non-normative example of a `tools/call` request carrying trace context:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "get_weather",
    "arguments": { "location": "New York" },
    "_meta": {
      "traceparent": "00-0af7651916cd43dd8448eb211c80319c-00f067aa0ba902b7-01"
    }
  }
}
```

The `traceparent` value format is normative in
[W3C Trace Context](https://www.w3.org/TR/trace-context/). Quoting the relevant
rules verbatim:

> "trace-id = 32HEXDIGLC ; 16 bytes array identifier. All zeroes forbidden"
> "parent-id = 16HEXDIGLC ; 8 bytes array identifier. All zeroes forbidden"

and for `tracestate` limits:

> "There can be a maximum of 32 `list-member`s in a `list`."
> "Entries larger than `128` characters long _SHOULD_ be removed first. Then
> entries _SHOULD_ be removed starting from the end of `tracestate`."

## The end-to-end trace

With the opt-in enabled (below), a single trace tree spans the whole call path —
the caller's spans, ferrumdeck's enforcement decision, and whatever ferrumdeck's
callee does next:

```
Trace 0af7651916cd43dd8448eb211c80319c
└─ host app: "chat turn"                         (root, sampled)
   └─ client SDK: mcp.client tools/call          traceparent set in params._meta
      └─ MCP server: tools/call get_weather
         └─ ferrumdeck: gen_ai.tool.call         ← parented on the caller's context
            ferrumdeck.decision = allow            (this is the span this feature adds)
            ferrumdeck.reason   = "tool 'get_weather' is in allowlist"
            └─ downstream tool / HTTP call         (server's own child spans)
```

The decision span is the **existing** enforcement span
(`fd_otel::decision::emit_tool_decision_span`) — this feature only sets its
*parent* from the extracted context. No second, parallel telemetry path is
introduced.

## What FerrumDeck does

- **Extracts** `traceparent` / `tracestate` / `baggage` from the tool-call
  request `_meta` (case-insensitive key lookup; liberal in what it accepts).
- **Validates** `traceparent` strictly per W3C: version `00`, 32-hex non-zero
  trace-id, 16-hex non-zero parent-id, 2-hex flags. A malformed value — including
  an all-zero trace-id or parent-id — is **rejected** (not propagated), and the
  decision span starts as a root exactly as before. An unvalidated trace-id is an
  injection surface into whatever consumes the audit log downstream, so it is
  never persisted.
- **Caps** `tracestate` and `baggage` to the W3C limits (32 members / 512 chars
  for tracestate, over-long entries dropped first; 180 members / 8192 bytes for
  baggage), **dropping** rather than erroring on overflow, and records that a drop
  occurred on the audit record.
- **Parents** the enforcement decision span on the extracted context so the trace
  reads end-to-end.
- **Persists** the trace-id and sampled flag on the enforcement decision record
  (the append-only `audit_events` row: dedicated `trace_id` / `span_id` columns
  plus a `trace_context` object in `details`), so an audit query can join a policy
  decision to its trace.

## What FerrumDeck does **not** guarantee

- **Not a conformance claim.** See the status note above — this implements the SEP-414 conventions; it is not
  a certified conformance to MCP 2026-07-28.
- **No emission back into `_meta`.** FerrumDeck reads inbound `_meta` and parents
  its own span; it does not (here) inject `_meta` into calls it makes onward.
  Downstream propagation from ferrumdeck's callee is that callee's concern.
- **Off unless opted in.** The feature is gated behind the same OTel semconv
  stability opt-in as the GenAI span naming —
  `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`. Unset, ferrumdeck
  ignores `_meta` trace context and starts a root span exactly as it always has;
  the OTel GenAI semconv is itself still *Development*-status, so an unstable field
  is not made mandatory.
- **No interpretation of `baggage` semantics or `tracestate` vendor entries.**
  They are validated for shape, capped, recorded, and (for tracestate) carried on
  the parent context — their meaning is the originating vendor's.
- **Structural validation, not authenticity.** A valid-looking `traceparent`
  proves the *format*, not that the caller is who they claim; trace correlation is
  an observability aid, not an authorization signal.

## Reproduce

The extraction + validation + capping logic is pure and unit-tested in
`rust/crates/fd-otel/src/trace_context.rs`; the decision-record persistence in
`rust/crates/fd-storage/tests/mcp_trace_persistence.rs`. Enable the opt-in and
send a `traceparent` in `_meta` on `POST /v1/runs/{id}/check-tool`:

```bash
export OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental
# ... the check-tool request body carries:
#   { "tool_name": "...", "_meta": { "traceparent": "00-<32hex>-<16hex>-01" } }
```

## References

- MCP SEP-414 — <https://modelcontextprotocol.io/seps/414-request-meta>
- MCP 2026-07-28 specification (ratified, current) — <https://modelcontextprotocol.io/specification/2026-07-28>
- MCP 2026-07-28 `_meta` reserved-key table — <https://modelcontextprotocol.io/specification/2026-07-28/basic/index#meta>
- W3C Trace Context — <https://www.w3.org/TR/trace-context/>
- W3C Baggage — <https://www.w3.org/TR/baggage/>
- OTel semantic conventions for MCP (context propagation) — <https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/mcp.md>
- Companion: enforcement decision spans — [ADR 0004](adr/0004-otel-genai-conventions.md)
