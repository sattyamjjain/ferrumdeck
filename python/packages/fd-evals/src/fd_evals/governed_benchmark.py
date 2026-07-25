"""Governed-vs-ungoverned benchmark: what does the policy engine cost, and what
does it stop?

Runs one **fixed** multi-step agent workload (a safe-PR-agent trajectory with a
set of injected unsafe tool actions) **twice**:

* **governed** — every tool call passes the deny-by-default allowlist + Airlock
  RASP (anti-RCE matcher, data-exfiltration shield) + a per-run cost budget,
  exactly the layered decision the Rust ``fd_policy`` control plane makes; and
* **ungoverned** — the same workload with the policy engine OFF, so every call
  (including the unsafe ones) executes.

and reports the two numbers no closed competitor (Alterion Draco, Microsoft
Agent 365, AWS AgentCore) publishes:

1. **% of unsafe tool actions blocked** — governed vs ungoverned.
2. **governance overhead** — the added per-decision latency (p50/p95), plus the
   added cost/tokens of the audit-decision records, and the *net* cost/token
   delta (which is typically **negative**: stopping the RCE, the raw-IP exfil,
   the denied tool, and the runaway over-budget loop saves more than the
   decisions cost).

## Honesty / reproducibility

The governance **decision** for each call reuses
:func:`fd_evals.injection_defense.decide`, which mirrors the real Rust
``fd_policy`` contract and is pinned to it by
``cargo test -p fd-policy --test governed_benchmark`` — so "blocked %" is not a
number this file invents. The workload is **fixed** (no LLM, no network), so the
blocked-set, the cost/token deltas, and the decision reasons are **deterministic
and reproducible** (a golden fixture pins them). The one thing that is *not*
golden-pinned is wall-clock latency, which is machine-dependent and measured per
run — reported as an order of magnitude, exactly as
``docs/benchmarks/enforcement-latency.md`` does. The ``seed`` is recorded for
provenance; the v1 workload is fixed, so results are seed-invariant.

Each governed decision is emitted on the existing OTel + GenAI-semconv decision
span path (``fd_runtime.trace_tool_decision`` → Jaeger), and the span's **W3C
``traceparent``** (per MCP SEP-414) is rendered and recorded so the benchmark
trace is portable across the MCP boundary. The existing path is reused, not
replaced.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fd_runtime.tracing import trace_tool_decision

from fd_evals.injection_defense import Governance, decide, load_governance

GOVERNED_BENCHMARK_ANCHOR = "governed-vs-ungoverned:ferrumdeck"

# The audit/decision record every governed call incurs — the *overhead* the
# policy engine adds. Small + fixed; the point of the benchmark is to show it is
# dwarfed by what governance stops. (Deterministic, so golden-pinned.)
GOVERNANCE_TOKENS_PER_DECISION = 40
GOVERNANCE_COST_CENTS_PER_DECISION = 0.02

# W3C traceparent (version 00): 32-hex trace-id, 16-hex span-id, 2-hex flags.
_TRACEPARENT_RE = re.compile(r"^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$")


@dataclass(frozen=True)
class Budget:
    """Per-run cost budget (cents) from the governance profile."""

    max_cost_cents: float
    max_tool_calls: int
    loop_threshold: int

    @classmethod
    def from_governance_file(cls, dataset_dir: Path) -> Budget:
        data = json.loads((dataset_dir / "governance.json").read_text())
        b = data.get("budget", {})
        return cls(
            max_cost_cents=float(b.get("max_cost_cents", 100)),
            max_tool_calls=int(b.get("max_tool_calls", 50)),
            loop_threshold=int(b.get("loop_threshold", 3)),
        )

    def has_headroom(self, used_cents: float, additional_cents: float) -> bool:
        """Whether spending ``additional`` more stays within the cap."""
        return used_cents + additional_cents <= self.max_cost_cents


def w3c_traceparent(span: Any) -> str:
    """Render the W3C ``traceparent`` (MCP SEP-414) for a span's context.

    This is the portable, standard representation of the OTel span context —
    ``00-<32-hex trace-id>-<16-hex span-id>-<2-hex flags>`` — so a downstream MCP
    consumer can stitch the benchmark trace into its own.
    """
    ctx = span.get_span_context()
    flags = int(getattr(ctx, "trace_flags", 0))
    return f"00-{ctx.trace_id:032x}-{ctx.span_id:016x}-{flags:02x}"


def is_valid_traceparent(tp: str) -> bool:
    """Whether ``tp`` is a well-formed W3C ``traceparent`` (deterministic check;
    the id values themselves are random per run, so only the shape is asserted)."""
    return bool(_TRACEPARENT_RE.match(tp))


@dataclass
class StepOutcome:
    """What happened to one workload step in one lane."""

    id: str
    tool_name: str
    kind: str  # benign | unsafe | approval
    unsafe_kind: str  # none | rce | exfil | deny | budget_loop
    executed: bool  # at least partially executed (loop: any iteration ran)
    blocked_by: str  # none | rce | exfil | allowlist | approval | budget
    iterations_total: int
    iterations_executed: int
    cost_cents: float  # execution cost actually incurred in this lane
    tokens: int  # execution tokens actually incurred in this lane
    traceparent: str | None = None  # governed lane only


@dataclass
class LaneResult:
    """One lane (governed / ungoverned) over the whole workload."""

    lane: str
    outcomes: list[StepOutcome]
    exec_cost_cents: float
    exec_tokens: int
    governance_cost_cents: float  # audit-decision overhead (0 for ungoverned)
    governance_tokens: int
    decision_latencies_ns: list[int] = field(default_factory=list)

    @property
    def total_cost_cents(self) -> float:
        return self.exec_cost_cents + self.governance_cost_cents

    @property
    def total_tokens(self) -> int:
        return self.exec_tokens + self.governance_tokens


def _blocked_reason(gov: Governance, tool_name: str, tool_input: dict[str, Any]) -> str:
    """Map the governed decision to a precise reason. ``decide`` collapses the
    allowlist + approval gates to ``allowlist``; we split ``approval`` back out so
    the report distinguishes 'denied unsafe tool' from 'human-in-the-loop gate'."""
    executed, blocked_by = decide(gov, tool_name, tool_input)
    if executed:
        return "none"
    if blocked_by == "allowlist" and tool_name in gov.approval_required:
        return "approval"
    return blocked_by  # allowlist | rce | exfil


def _percentile(values: list[int], pct: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    k = max(0, min(len(s) - 1, int(round((pct / 100.0) * (len(s) - 1)))))
    return float(s[k])


def run_governed(
    workload: list[dict[str, Any]],
    gov: Governance,
    budget: Budget,
    *,
    emit_spans: bool = True,
) -> LaneResult:
    """Run the workload through the full policy engine (allowlist + Airlock +
    budget), timing each decision and emitting a W3C-trace-context span."""
    outcomes: list[StepOutcome] = []
    exec_cost = 0.0
    exec_tokens = 0
    gov_cost = 0.0
    gov_tokens = 0
    latencies: list[int] = []

    for step in workload:
        tool = step["tool_name"]
        tinput = step.get("tool_input", {})
        repeat = int(step.get("repeat", 1))
        per_cost = float(step["cost_cents"])
        per_tokens = int(step["tokens_in"]) + int(step["tokens_out"])

        iters_exec = 0
        exec_cost_step = 0.0
        exec_tokens_step = 0
        reason = "none"
        traceparent: str | None = None

        for _ in range(repeat):
            # The governed decision — timed. Allowlist/Airlock first, then budget.
            t0 = time.perf_counter_ns()
            reason = _blocked_reason(gov, tool, tinput)
            allowed = reason == "none"
            if allowed and not budget.has_headroom(exec_cost + exec_cost_step, per_cost):
                allowed = False
                reason = "budget"
            latencies.append(time.perf_counter_ns() - t0)

            # Every decision writes an audit record — the governance overhead.
            gov_cost += GOVERNANCE_COST_CENTS_PER_DECISION
            gov_tokens += GOVERNANCE_TOKENS_PER_DECISION

            if emit_spans:
                decision = "allow" if allowed else ("approval" if reason == "approval" else "deny")
                with trace_tool_decision(
                    tool, decision, f"governed_benchmark: {reason}", step_id=step["id"]
                ) as span:
                    tp = w3c_traceparent(span)
                    span.set_attribute("mcp.traceparent", tp)
                    if traceparent is None:
                        traceparent = tp

            if allowed:
                iters_exec += 1
                exec_cost_step += per_cost
                exec_tokens_step += per_tokens

        exec_cost += exec_cost_step
        exec_tokens += exec_tokens_step
        outcomes.append(
            StepOutcome(
                id=step["id"],
                tool_name=tool,
                kind=step.get("kind", "benign"),
                unsafe_kind=step.get("unsafe_kind", "none"),
                executed=iters_exec > 0,
                blocked_by=reason if iters_exec < repeat else "none",
                iterations_total=repeat,
                iterations_executed=iters_exec,
                cost_cents=exec_cost_step,
                tokens=exec_tokens_step,
                traceparent=traceparent,
            )
        )

    return LaneResult(
        lane="governed",
        outcomes=outcomes,
        exec_cost_cents=exec_cost,
        exec_tokens=exec_tokens,
        governance_cost_cents=round(gov_cost, 6),
        governance_tokens=gov_tokens,
        decision_latencies_ns=latencies,
    )


def run_ungoverned(workload: list[dict[str, Any]]) -> LaneResult:
    """Run the workload with the policy engine OFF — every call executes."""
    outcomes: list[StepOutcome] = []
    exec_cost = 0.0
    exec_tokens = 0
    for step in workload:
        repeat = int(step.get("repeat", 1))
        cost = float(step["cost_cents"]) * repeat
        tokens = (int(step["tokens_in"]) + int(step["tokens_out"])) * repeat
        exec_cost += cost
        exec_tokens += tokens
        outcomes.append(
            StepOutcome(
                id=step["id"],
                tool_name=step["tool_name"],
                kind=step.get("kind", "benign"),
                unsafe_kind=step.get("unsafe_kind", "none"),
                executed=True,
                blocked_by="none",
                iterations_total=repeat,
                iterations_executed=repeat,
                cost_cents=cost,
                tokens=tokens,
            )
        )
    return LaneResult(
        lane="ungoverned",
        outcomes=outcomes,
        exec_cost_cents=exec_cost,
        exec_tokens=exec_tokens,
        governance_cost_cents=0.0,
        governance_tokens=0,
    )


# =============================================================================
# AP2 payment rail — the second rail on the same pre-call spend gate.
# =============================================================================
#
# Where the tool-call lanes above measure governance over the deny-by-default
# allowlist + Airlock + budget, this section measures it over **autonomous
# payments** authorized by a Google AP2 signed-Mandate chain. The governed
# decision mirrors the real Rust ``fd_policy::evaluate_ap2_payment`` (Ed25519
# signature-chain verification + intent-scope check + the **same per-task cost
# ceiling** the x402 gate uses); it is pinned to the real engine by
# ``cargo test -p fd-policy --test ap2_gate``. The mandate fixtures carry the
# *verified state* (``signature_valid`` / ``in_scope``) exactly as the tool-call
# lane's ``decide`` models an Airlock verdict — the cryptography itself is proven
# on the Rust plane, this lane models the governance decision it produces.


@dataclass
class Ap2Outcome:
    """What happened to one AP2 mandate in one lane."""

    id: str
    merchant: str
    total_cents: float
    kind: str  # valid | unsafe
    unsafe_kind: str  # none | invalid_signature | over_ceiling | scope_mismatch
    authorized: bool
    blocked_by: (
        str  # none | invalid_signature | intent_scope_mismatch | cart_over_ceiling | unpriceable
    )
    traceparent: str | None = None  # governed lane only


def decide_ap2(mandate: dict[str, Any], budget: Budget, used_cents: float) -> tuple[bool, str]:
    """The governed AP2 decision, mirroring ``fd_policy::evaluate_ap2_payment``.

    Deny-by-default, in the same order the Rust gate applies: currency priceable
    → signature chain → intent scope (merchant/category + the user's own max) →
    the per-task budget ceiling. Returns ``(authorized, blocked_by)``.
    """
    if str(mandate.get("currency", "USD")).upper() != "USD":
        return (False, "unpriceable")
    if not bool(mandate.get("signature_valid", False)):
        return (False, "invalid_signature")
    total = float(mandate["total_cents"])
    intent_max = float(mandate.get("intent_max_cents", float("inf")))
    if not bool(mandate.get("in_scope", True)) or total > intent_max:
        return (False, "intent_scope_mismatch")
    if not budget.has_headroom(used_cents, total):
        return (False, "cart_over_ceiling")
    return (True, "none")


def run_ap2_governed(
    mandates: list[dict[str, Any]],
    budget: Budget,
    *,
    emit_spans: bool = True,
) -> tuple[list[Ap2Outcome], float, int, list[int]]:
    """Gate each mandate through the verifier before authorizing. Emits the same
    governance evidence the x402 path emits: a W3C-trace-context decision span
    and an audit record of the authorized payment. Returns
    ``(outcomes, governance_cost_cents, governance_tokens, latencies_ns)``."""
    outcomes: list[Ap2Outcome] = []
    used = 0.0
    gov_cost = 0.0
    gov_tokens = 0
    latencies: list[int] = []

    for m in mandates:
        total = float(m["total_cents"])

        t0 = time.perf_counter_ns()
        authorized, blocked_by = decide_ap2(m, budget, used)
        latencies.append(time.perf_counter_ns() - t0)

        # Every AP2 decision writes an audit record — the governance overhead.
        gov_cost += GOVERNANCE_COST_CENTS_PER_DECISION
        gov_tokens += GOVERNANCE_TOKENS_PER_DECISION

        traceparent: str | None = None
        if emit_spans:
            decision = "allow" if authorized else "deny"
            reason = f"ap2 governed_benchmark: {blocked_by if not authorized else 'authorized'}"
            with trace_tool_decision("ap2_payment", decision, reason, step_id=m["id"]) as span:
                traceparent = w3c_traceparent(span)
                span.set_attribute("mcp.traceparent", traceparent)
                # The authorized-payment audit record on the same span: cents +
                # the mandate chain ids (mirrors fd_otel record_ap2_cost).
                span.set_attribute("ferrumdeck.cost.ap2_cents", int(total) if authorized else 0)
                span.set_attribute("ferrumdeck.ap2.merchant", str(m["merchant"]))
                span.set_attribute("ferrumdeck.ap2.intent_id", str(m.get("intent_id", "")))
                span.set_attribute("ferrumdeck.ap2.cart_id", str(m.get("cart_id", "")))
                span.set_attribute(
                    "ferrumdeck.ap2.decision", "authorize" if authorized else blocked_by
                )

        if authorized:
            used += total

        outcomes.append(
            Ap2Outcome(
                id=m["id"],
                merchant=str(m["merchant"]),
                total_cents=total,
                kind=m.get("kind", "valid"),
                unsafe_kind=m.get("unsafe_kind", "none"),
                authorized=authorized,
                blocked_by=blocked_by,
                traceparent=traceparent,
            )
        )
    return outcomes, round(gov_cost, 6), gov_tokens, latencies


def run_ap2_ungoverned(mandates: list[dict[str, Any]]) -> list[Ap2Outcome]:
    """Run the mandates with the gate OFF — every payment is authorized and paid,
    signature-invalid and over-budget included."""
    return [
        Ap2Outcome(
            id=m["id"],
            merchant=str(m["merchant"]),
            total_cents=float(m["total_cents"]),
            kind=m.get("kind", "valid"),
            unsafe_kind=m.get("unsafe_kind", "none"),
            authorized=True,
            blocked_by="none",
        )
        for m in mandates
    ]


@dataclass
class Ap2Comparison:
    """The AP2 payment-rail governed-vs-ungoverned comparison."""

    governed: list[Ap2Outcome]
    ungoverned: list[Ap2Outcome]
    governance_cost_cents: float
    governance_tokens: int
    latencies_ns: list[int] = field(default_factory=list)

    @property
    def unsafe_total(self) -> int:
        return sum(1 for o in self.ungoverned if o.kind == "unsafe")

    @property
    def governed_blocked(self) -> int:
        return sum(1 for o in self.governed if o.kind == "unsafe" and not o.authorized)

    @property
    def ungoverned_blocked(self) -> int:
        return sum(1 for o in self.ungoverned if o.kind == "unsafe" and not o.authorized)

    @property
    def governed_block_pct(self) -> float:
        return 100.0 * self.governed_blocked / self.unsafe_total if self.unsafe_total else 0.0

    @property
    def authorized_count(self) -> int:
        return sum(1 for o in self.governed if o.authorized)

    @property
    def governed_exec_cost_cents(self) -> float:
        return round(sum(o.total_cents for o in self.governed if o.authorized), 4)

    @property
    def ungoverned_exec_cost_cents(self) -> float:
        return round(sum(o.total_cents for o in self.ungoverned), 4)

    @property
    def net_cost_delta_cents(self) -> float:
        """(governed exec + governance overhead) − ungoverned exec. Negative ⇒
        the gate net-saved by refusing the unsafe/over-budget payments."""
        return round(
            self.governed_exec_cost_cents
            + self.governance_cost_cents
            - self.ungoverned_exec_cost_cents,
            4,
        )

    @property
    def sample_traceparent(self) -> str | None:
        for o in self.governed:
            if o.traceparent:
                return o.traceparent
        return None

    def to_dict(self) -> dict[str, Any]:
        return {
            "rail": "ap2",
            "unsafe_total": self.unsafe_total,
            "governed_blocked": self.governed_blocked,
            "ungoverned_blocked": self.ungoverned_blocked,
            "governed_block_pct": round(self.governed_block_pct, 2),
            "authorized_count": self.authorized_count,
            "governed_exec_cost_cents": self.governed_exec_cost_cents,
            "ungoverned_exec_cost_cents": self.ungoverned_exec_cost_cents,
            "net_cost_delta_cents": self.net_cost_delta_cents,
            "mandates": [
                {
                    "id": g.id,
                    "merchant": g.merchant,
                    "kind": g.kind,
                    "unsafe_kind": g.unsafe_kind,
                    "governed_blocked_by": g.blocked_by,
                    "governed_authorized": g.authorized,
                    "ungoverned_authorized": u.authorized,
                }
                for g, u in zip(self.governed, self.ungoverned, strict=True)
            ],
        }


def load_ap2_mandates(dataset_dir: Path) -> list[dict[str, Any]]:
    path = dataset_dir / "ap2_mandates.jsonl"
    if not path.exists():
        return []
    return [json.loads(ln) for ln in path.read_text().splitlines() if ln.strip()]


def run_ap2(dataset_dir: Path, budget: Budget, *, emit_spans: bool = True) -> Ap2Comparison | None:
    """Run the AP2 payment-rail governed-vs-ungoverned lane, reusing the SAME
    per-task ``budget`` ceiling as the tool-call + x402 gates. ``None`` when the
    dataset has no AP2 mandates."""
    mandates = load_ap2_mandates(dataset_dir)
    if not mandates:
        return None
    governed, gov_cost, gov_tokens, latencies = run_ap2_governed(
        mandates, budget, emit_spans=emit_spans
    )
    ungoverned = run_ap2_ungoverned(mandates)
    return Ap2Comparison(
        governed=governed,
        ungoverned=ungoverned,
        governance_cost_cents=gov_cost,
        governance_tokens=gov_tokens,
        latencies_ns=latencies,
    )


@dataclass
class BenchmarkResult:
    """The governed-vs-ungoverned comparison + the headline metrics."""

    governed: LaneResult
    ungoverned: LaneResult
    seed: int
    anchor: str = GOVERNED_BENCHMARK_ANCHOR
    ap2: Ap2Comparison | None = None

    # ---- unsafe-action blocking ----
    @property
    def unsafe_total(self) -> int:
        return sum(1 for o in self.ungoverned.outcomes if o.kind == "unsafe")

    def _unsafe_blocked(self, lane: LaneResult) -> int:
        return sum(1 for o in lane.outcomes if o.kind == "unsafe" and o.blocked_by != "none")

    @property
    def governed_blocked(self) -> int:
        return self._unsafe_blocked(self.governed)

    @property
    def ungoverned_blocked(self) -> int:
        return self._unsafe_blocked(self.ungoverned)

    @property
    def governed_block_pct(self) -> float:
        return 100.0 * self.governed_blocked / self.unsafe_total if self.unsafe_total else 0.0

    @property
    def ungoverned_block_pct(self) -> float:
        return 100.0 * self.ungoverned_blocked / self.unsafe_total if self.unsafe_total else 0.0

    @property
    def approval_gated(self) -> int:
        return sum(1 for o in self.governed.outcomes if o.blocked_by == "approval")

    # ---- overhead ----
    @property
    def added_latency_p50_us(self) -> float:
        return _percentile(self.governed.decision_latencies_ns, 50) / 1000.0

    @property
    def added_latency_p95_us(self) -> float:
        return _percentile(self.governed.decision_latencies_ns, 95) / 1000.0

    @property
    def governance_overhead_cost_cents(self) -> float:
        return round(self.governed.governance_cost_cents, 4)

    @property
    def governance_overhead_tokens(self) -> int:
        return self.governed.governance_tokens

    @property
    def net_cost_delta_cents(self) -> float:
        """governed total − ungoverned total (negative ⇒ governance net-saved)."""
        return round(self.governed.total_cost_cents - self.ungoverned.total_cost_cents, 4)

    @property
    def net_tokens_delta(self) -> int:
        return self.governed.total_tokens - self.ungoverned.total_tokens

    @property
    def sample_traceparent(self) -> str | None:
        for o in self.governed.outcomes:
            if o.traceparent:
                return o.traceparent
        return None

    def to_dict(self) -> dict[str, Any]:
        """Deterministic subset (blocked-set, reasons, cost/token deltas) suitable
        for a golden fixture — wall-clock latency is intentionally excluded."""
        return {
            "anchor": self.anchor,
            "unsafe_total": self.unsafe_total,
            "governed_blocked": self.governed_blocked,
            "ungoverned_blocked": self.ungoverned_blocked,
            "governed_block_pct": round(self.governed_block_pct, 2),
            "ungoverned_block_pct": round(self.ungoverned_block_pct, 2),
            "approval_gated": self.approval_gated,
            "governance_overhead_cost_cents": self.governance_overhead_cost_cents,
            "governance_overhead_tokens": self.governance_overhead_tokens,
            "net_cost_delta_cents": self.net_cost_delta_cents,
            "net_tokens_delta": self.net_tokens_delta,
            "governed": {
                "exec_cost_cents": round(self.governed.exec_cost_cents, 4),
                "exec_tokens": self.governed.exec_tokens,
                "total_cost_cents": round(self.governed.total_cost_cents, 4),
            },
            "ungoverned": {
                "exec_cost_cents": round(self.ungoverned.exec_cost_cents, 4),
                "exec_tokens": self.ungoverned.exec_tokens,
                "total_cost_cents": round(self.ungoverned.total_cost_cents, 4),
            },
            "decisions": [
                {
                    "id": g.id,
                    "tool": g.tool_name,
                    "kind": g.kind,
                    "unsafe_kind": g.unsafe_kind,
                    "governed_blocked_by": g.blocked_by,
                    "governed_iters": f"{g.iterations_executed}/{g.iterations_total}",
                    "ungoverned_executed": u.executed,
                }
                for g, u in zip(self.governed.outcomes, self.ungoverned.outcomes, strict=True)
            ],
            "ap2": self.ap2.to_dict() if self.ap2 else None,
        }

    def to_markdown(self) -> str:
        d = self.to_dict()
        lines = [
            "# Governed-vs-Ungoverned Benchmark",
            "",
            f"**Anchor:** {self.anchor}  ·  **Seed:** {self.seed}  ·  "
            f"**Unsafe actions injected:** {self.unsafe_total}",
            "",
            "> One fixed safe-PR-agent workload, run with the deny-by-default policy "
            "engine + Airlock + budget ON (governed) and OFF (ungoverned). "
            "Deterministic, offline, no LLM. Blocked-% is pinned to the real Rust "
            "`fd_policy` by `cargo test -p fd-policy --test governed_benchmark`.",
            "",
            "## Headline",
            "",
            "| Metric | Governed | Ungoverned |",
            "|---|---|---|",
            f"| Unsafe tool actions blocked | **{self.governed_blocked}/{self.unsafe_total} "
            f"({self.governed_block_pct:.0f}%)** | {self.ungoverned_blocked}/{self.unsafe_total} "
            f"({self.ungoverned_block_pct:.0f}%) |",
            f"| Total cost (cents) | {self.governed.total_cost_cents:.2f} | "
            f"{self.ungoverned.total_cost_cents:.2f} |",
            f"| Total tokens | {self.governed.total_tokens} | {self.ungoverned.total_tokens} |",
            "",
            "## Governance overhead",
            "",
            "| Metric | Value |",
            "|---|---|",
            f"| Added decision latency p50 | {self.added_latency_p50_us:.2f} µs |",
            f"| Added decision latency p95 | {self.added_latency_p95_us:.2f} µs |",
            f"| Audit-decision overhead (cost) | {self.governance_overhead_cost_cents:.2f} cents |",
            f"| Audit-decision overhead (tokens) | {self.governance_overhead_tokens} |",
            f"| **Net cost delta** (governed − ungoverned) | "
            f"**{self.net_cost_delta_cents:+.2f} cents** |",
            f"| Net tokens delta | {self.net_tokens_delta:+d} |",
            f"| Approval-gated (human-in-the-loop) actions | {self.approval_gated} |",
            "",
            f"Sample W3C traceparent (MCP SEP-414): `{self.sample_traceparent}`",
            "",
            "## Per-step decisions",
            "",
            "| Step | Tool | Kind | Governed | Ungoverned |",
            "|---|---|---|---|---|",
        ]
        for row in d["decisions"]:
            gb = row["governed_blocked_by"]
            gov = "✅ ran" if gb == "none" else f"🛑 {gb} ({row['governed_iters']})"
            ung = "ran" if row["ungoverned_executed"] else "—"
            lines.append(
                f"| {row['id']} | `{row['tool']}` | {row['unsafe_kind']} | {gov} | {ung} |"
            )

        if self.ap2 is not None:
            a = self.ap2
            lines += [
                "",
                "## Payment-rail coverage: AP2 (Google Agent Payments Protocol)",
                "",
                "> The **same pre-call spend gate**, extended to autonomous payments "
                "authorized by a signed Intent + Cart Mandate chain. Governed verifies "
                "the Ed25519 signature chain + intent scope + the **same per-task cost "
                "ceiling** the x402 gate uses, *before* authorizing; ungoverned pays "
                "every mandate. Pinned to the real Rust engine by "
                "`cargo test -p fd-policy --test ap2_gate`.",
                "",
                "| Metric | Governed | Ungoverned |",
                "|---|---|---|",
                f"| Unsafe payments blocked | **{a.governed_blocked}/{a.unsafe_total} "
                f"({a.governed_block_pct:.0f}%)** | {a.ungoverned_blocked}/{a.unsafe_total} "
                f"({100.0 * a.ungoverned_blocked / a.unsafe_total if a.unsafe_total else 0:.0f}%) |",
                f"| Payments authorized | {a.authorized_count} | {len(a.ungoverned)} |",
                f"| Payment spend (cents) | {a.governed_exec_cost_cents:.2f} | "
                f"{a.ungoverned_exec_cost_cents:.2f} |",
                f"| **Net cost delta** (governed − ungoverned) | "
                f"**{a.net_cost_delta_cents:+.2f} cents** | — |",
                "",
                f"Sample W3C traceparent (MCP SEP-414): `{a.sample_traceparent}`",
                "",
                "| Mandate | Merchant | Unsafe kind | Governed | Ungoverned |",
                "|---|---|---|---|---|",
            ]
            for row in d["ap2"]["mandates"]:
                gov = (
                    "✅ paid" if row["governed_authorized"] else f"🛑 {row['governed_blocked_by']}"
                )
                ung = "paid" if row["ungoverned_authorized"] else "—"
                lines.append(
                    f"| {row['id']} | `{row['merchant']}` | {row['unsafe_kind']} | {gov} | {ung} |"
                )

        return "\n".join(lines)


def load_workload(dataset_dir: Path) -> list[dict[str, Any]]:
    lines = (dataset_dir / "workload.jsonl").read_text().splitlines()
    return [json.loads(ln) for ln in lines if ln.strip()]


def run_benchmark(dataset_dir: Path, *, seed: int = 0, emit_spans: bool = True) -> BenchmarkResult:
    """Run the full governed-vs-ungoverned comparison over the dataset."""
    workload = load_workload(dataset_dir)
    gov = load_governance(dataset_dir)
    budget = Budget.from_governance_file(dataset_dir)
    governed = run_governed(workload, gov, budget, emit_spans=emit_spans)
    ungoverned = run_ungoverned(workload)
    ap2 = run_ap2(dataset_dir, budget, emit_spans=emit_spans)
    return BenchmarkResult(governed=governed, ungoverned=ungoverned, seed=seed, ap2=ap2)


__all__ = [
    "GOVERNANCE_COST_CENTS_PER_DECISION",
    "GOVERNANCE_TOKENS_PER_DECISION",
    "GOVERNED_BENCHMARK_ANCHOR",
    "Ap2Comparison",
    "Ap2Outcome",
    "BenchmarkResult",
    "Budget",
    "LaneResult",
    "StepOutcome",
    "decide_ap2",
    "is_valid_traceparent",
    "load_ap2_mandates",
    "load_workload",
    "run_ap2",
    "run_benchmark",
    "run_governed",
    "run_ungoverned",
    "w3c_traceparent",
]
