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


@dataclass
class BenchmarkResult:
    """The governed-vs-ungoverned comparison + the headline metrics."""

    governed: LaneResult
    ungoverned: LaneResult
    seed: int
    anchor: str = GOVERNED_BENCHMARK_ANCHOR

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
    return BenchmarkResult(governed=governed, ungoverned=ungoverned, seed=seed)


__all__ = [
    "GOVERNANCE_COST_CENTS_PER_DECISION",
    "GOVERNANCE_TOKENS_PER_DECISION",
    "GOVERNED_BENCHMARK_ANCHOR",
    "BenchmarkResult",
    "Budget",
    "LaneResult",
    "StepOutcome",
    "is_valid_traceparent",
    "load_workload",
    "run_benchmark",
    "run_governed",
    "run_ungoverned",
    "w3c_traceparent",
]
