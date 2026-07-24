# x402 spend gate — governance for autonomous payments

The "governed vs ungoverned" story, extended from tool calls to **money**.

The [x402 protocol](https://x402.org) lets an agent pay for a paywalled resource
inline: the server answers an outbound HTTP request with **`402 Payment
Required`** and a stablecoin price quote, and the agent is expected to pay and
retry. That turns an agent's budget from a token-accounting problem into a
**spending** problem — an over-eager or prompt-injected agent can now drain a
wallet one 402 at a time.

FerrumDeck's spend gate closes that gap by extending the *same* per-agent budget
that already caps token/model spend. Given a 402 quote it:

1. **reads the price** off the challenge (amount, asset, scheme),
2. **normalizes it to cents** — the common budget unit — as a first-class cost
   event that lands in the same ledger as token cost, and
3. **checks it against the remaining budget *before* authorizing the payment**,
   hard-stopping (deny + one alert) if paying would breach the ceiling.

## Run it

```bash
./examples/x402-spend-gate/run.sh
# or directly:
cargo run -p ferrumdeck --example x402_spend_gate
```

It's **self-verifying**: the demo exits non-zero if the gate ever fails to block
the over-budget payment, so you get a hard pass/fail, not a screenshot to trust.

### What you'll see

A per-agent **$1.00 cost cap** with 10¢ of inference already spent, then a fixed
sequence of paywalled x402 quotes (USDC on base-sepolia) run two ways:

- **Ungoverned** — the agent pays every quote and sails to **155¢**, 55¢ over
  the budget. Nothing is in the path to stop it.
- **Governed** — the gate authorizes three quotes (drawing the budget down to
  10¢ remaining), then **hard-stops the 40¢ quote that would breach the cap**,
  with a single operator alert. Final spend **90¢ ≤ 100¢ cap**; the over-budget
  payment never settles.

## It never moves money

This is a **gate + cost model**, not a wallet. It parses simulated 402 bodies,
prices them, and returns an authorize/deny *decision*. There is no key, no chain,
no settlement here — signing an `X-PAYMENT` header and broadcasting a transfer
live entirely outside FerrumDeck. The demo is `simulate → gate → record` only.

## Where the engine code lives

- Gate + cost model: [`fd_policy::x402`](../../rust/crates/fd-policy/src/x402.rs)
  — `X402Challenge`, `X402CostEvent`, `evaluate_x402_payment`, `X402GateOutcome`.
  Reuses the exact `Budget::has_cost_headroom` primitive the R2 token gate uses.
- OTel cost event: `fd_otel::genai::span_helpers::record_x402_cost` — a paid call
  rides the same span as its token cost (`ferrumdeck.cost.x402_cents`).
- Runnable demo:
  [`rust/crates/ferrumdeck/examples/x402_spend_gate.rs`](../../rust/crates/ferrumdeck/examples/x402_spend_gate.rs).

## Why now

- **[x402 Foundation](https://www.linuxfoundation.org/press/linux-foundation-announces-operational-launch-of-x402-foundation-to-standardize-internet-native-payments-for-ai-agents-and-applications)**
  launched under the Linux Foundation (2026-07-14) to standardize HTTP-native
  agent payments (Coinbase-contributed protocol; Visa, Stripe, Solana among the
  members).
- **[Cloudflare Monetization Gateway](https://blog.cloudflare.com/monetization-gateway/)**
  (2026-07-01) began charging AI agents per access over x402 — so paywalled
  endpoints an agent hits in the wild are already real.
- **[Databricks Unity AI Gateway](https://www.databricks.com/blog/ai-governance-data-ai-summit-2026-whats-new-unity-ai-gateway)**
  governs any model/agent/MCP service at runtime with **hard spend caps** — the
  same shape of control, at platform scale.
- **[FinOps FOCUS 1.4](https://siliconangle.com/2026/06/08/focus-specification-ai-cost-accountability-finopsx/)**
  (ratified 2026-06-04) and the Linux Foundation's new Tokenomics Foundation are
  extending cost accounting to AI token/agent economics — a run's cost slope now
  has to include paid-API calls, not just inference.
