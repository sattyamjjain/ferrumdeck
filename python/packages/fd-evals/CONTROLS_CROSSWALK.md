# FerrumDeck controls → CISA/NSA agentic-AI risk crosswalk

This maps each FerrumDeck enforcement control to the five risk categories in the
**Five Eyes joint guidance _Careful Adoption of Agentic AI Services_** (CISA, NSA,
and the cyber agencies of Australia, Canada, New Zealand, and the UK; May 2026).
It is a **positioning artifact**, not a compliance certification — the guidance is
advisory and defines risk categories, not a control checklist. Where a control
enforces vs. only records, or is wired vs. roadmap, is called out honestly below.

> **Source.** CISA et al., _Careful Adoption of Agentic AI Services_ (2026). The
> five categories used here — **privilege & access**, **design & configuration**,
> **behavioral misalignment**, **structural brittleness**, **accountability** —
> are the guidance's own risk taxonomy; the exact wording varies across the
> advisory and its summaries.

## The five risk categories (as we read them)

| # | Category | Risk in one line |
|---|---|---|
| R1 | **Privilege & access** | Over-broad permissions let a compromised/agentic actor cause wide harm across tools and funds. |
| R2 | **Design & configuration** | Poor defaults, static trust, and stale permissions enable exploitation and lateral movement. |
| R3 | **Behavioral misalignment** | Agents act unpredictably or are manipulated (prompt injection, data poisoning) into unsafe actions. |
| R4 | **Structural brittleness** | Interconnected, multi-step, delegated workflows cascade into runaway failures / expanded attack surface. |
| R5 | **Accountability** | Opacity makes it hard to trace a decision, audit an action, or assign responsibility. |

## Crosswalk — control → category

Each control lists its **primary** category, the mechanism, the code path, and the
**evidence** (a test/eval that exercises it), plus mode (enforce vs shadow).

| Control | Primary | Also | Mechanism | Code path | Evidence |
|---|---|---|---|---|---|
| **Deny-by-default tool allowlist** | R1 | R2 | Per-agent allowlist; an unlisted or denied tool never auto-executes (deny-by-default). | `fd-policy/src/rules.rs` | `injection_defense` corpus: 6/6 `unauthorized_tool` blocked; `cargo test -p ferrumdeck-policy --test injection_defense` |
| **Reversibility ladder (R1–R3)** | R1 | R4 | Irreversible/costly actions escalate to an approval gate; unknown tools default to `irreversible`. | `fd-policy/src/reversibility.rs` | unit tests in module; `docs/runbooks/graduated-response-levels.md` |
| **Spend gate — budget** | R1 | R4 | Per-run/per-agent hard cost ceiling; `has_cost_headroom` gates spend; auto-kill on breach. | `fd-policy/src/budget.rs` | `governed_benchmark`: over-budget loop stopped 2/6 iters; `cargo test -p ferrumdeck-policy --test governed_benchmark` |
| **Spend gate — x402** | R1 | R5 | Prices an inline HTTP-402 quote in cents, checks the **same** ceiling before authorizing an autonomous payment; deny + one alert on breach. | `fd-policy/src/x402.rs` | `x402_spend_gate` example; `fd-policy` x402 unit tests |
| **Spend gate — AP2 signed mandates** | R1 | R5, R2 | Verifies an Ed25519 Intent+Cart mandate chain + intent scope + the same ceiling before authorizing; deny-by-default on bad sig / over-ceiling / out-of-scope. | `fd-policy/src/ap2.rs` | `cargo test -p ferrumdeck-policy --test ap2_gate` (real Ed25519); AP2 benchmark row: 3/3 unsafe blocked |
| **Airlock anti-RCE matcher** | R3 | — | Blocks `eval`/`exec`/shell-injection/path-traversal patterns in tool input (enforce mode). | `fd-policy/src/airlock/patterns.rs` · `inspector.rs` | `injection_defense`: 6/6 `rce_payload` blocked |
| **Data-exfiltration shield** | R3 | R1 | Domain allowlist + raw-IP block on network tools; stops injected exfil / C2. | `fd-policy/src/airlock/exfiltration.rs` | `injection_defense`: 5/5 `exfil_domain` blocked |
| **Credential DLP** | R3 | R5 | Scans outbound payloads for cloud keys / tokens / Luhn PANs / IBANs before egress. | `fd-policy/src/airlock/credential_dlp.rs` | `credential_dlp` unit tests |
| **Behavioral-drift monitor** | R3 | R4 | Per-agent rolling z-score on per-call cost/behavior; flags out-of-envelope actions. | `fd-policy/src/airlock/behavioral_drift.rs` | `behavioral_drift` unit tests |
| **Coherence-divergence monitor** | R3 | R5 | Flags a stated blocking fact followed by a contradicting closure action mid-trajectory. | `fd-policy/src/airlock/coherence.rs` | `coherence` demo + unit tests |
| **Transparency (EU AI Act Art. 50)** | R5 | R3 | A governed generative response must carry a human-readable AI disclosure + a machine-readable synthetic-content marker; missing → denied (enforce) / logged (shadow). | `fd-policy/src/transparency_art50.rs` | `asb` + Art.50 tests; see EU-AI-Act note below |
| **Colorado SB 26-189 ADMT record** | R5 | — | Queryable "what decided this, when, on what inputs" record + 3-year retention floor on consequential decisions. | `fd-policy/src/colorado_sb26_189.rs` | `cargo test -p ferrumdeck-policy --test colorado_sb26_189` |
| **Immutable audit trail** | R5 | R4 | Append-only `audit_events` (no `UPDATE`/`DELETE`); every allow/deny/approval/kill recorded. | `fd-audit/` · `db/migrations/*audit*` | audit round-trip tests; retention-floor migration |
| **OTel enforcement-decision spans + W3C trace-context** | R5 | R3 | Every in-path verdict is a queryable GenAI span (`ferrumdeck.decision`) correlated across the MCP boundary via `traceparent` (SEP-414). | `fd-otel/src/decision.rs` · `trace_context.rs` | `enforce_vs_observe`; `governed_benchmark` traceparent test |

## Coverage — category → controls

| Category | Controls covering it | Enforced today? |
|---|---|---|
| **R1 Privilege & access** | allowlist, reversibility ladder, budget + x402 + AP2 spend gates | Yes (enforce mode) |
| **R2 Design & configuration** | deny-by-default posture, AP2 keyring (no static trust), explicit budget ceilings | Yes — deny-by-default is the default config |
| **R3 Behavioral misalignment** | anti-RCE matcher, exfil shield, credential DLP, behavioral-drift, coherence, transparency | Anti-RCE/exfil enforce; drift/coherence default **shadow** (record, don't block) |
| **R4 Structural brittleness** | budget auto-kill + loop detection, delegation-aware budget leases, reversibility ladder | Yes for budget/loop; leases are library-level |
| **R5 Accountability** | immutable audit trail, OTel decision spans + W3C trace-context, transparency, Colorado ADMT record | Yes — recording is always on |

## EU AI Act tie-in (R5 / R3)

The transparency control (`fd-policy/src/transparency_art50.rs`) targets **EU AI
Act Article 50**, whose transparency duties — chatbot/AI-interaction disclosure and
**machine-readable marking of AI-generated content** — become enforceable on
**2026-08-02**, alongside the GPAI-provider obligations (fines up to €15M or 3% of
global turnover). FerrumDeck enforces the marker at the gateway: in `enforce` mode a
governed response missing either the human disclosure or the machine-readable marker
is **denied before release**; in `shadow` it is logged. This is a **structural
check, not legal advice** — it verifies the marker is present, not that a given
deployment is Art. 50-compliant.

## Honest caveats

- **Advisory, not a checklist.** The CISA guidance defines *risks*, not controls;
  this crosswalk is our mapping, and reasonable readers may bin a control
  differently (several controls span categories).
- **Enforce vs shadow.** Allowlist, anti-RCE, exfil shield, budget, x402/AP2, and
  transparency **block** in enforce mode. Behavioral-drift and coherence default to
  **shadow** (surface, don't block) — they are detection signals until an operator
  opts into enforcement.
- **Wired vs library.** The gateway wires the allowlist, Airlock (anti-RCE/exfil),
  budget, and transparency into the request path. Delegation-aware budget leases and
  some drift monitors are implemented and tested at the crate level; end-to-end
  gateway wiring for a few is still in progress (see the README "Project Status &
  Limitations").
- **Not model robustness.** These controls gate *actions*, not model outputs. They
  reduce the blast radius of a misaligned or injected agent; they do not make the
  underlying model safe.

_Generated for FerrumDeck 0.7.11 · 2026-07-26. See
[`GOVERNED_BENCHMARK_RESULTS.md`](./GOVERNED_BENCHMARK_RESULTS.md) for the measured
numbers behind the "Evidence" column._
