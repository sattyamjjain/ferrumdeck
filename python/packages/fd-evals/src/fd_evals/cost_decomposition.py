"""Debt-vs-tax cost decomposition (§2605.27320).

An agent run's total cost is **not** all forward progress. The paper
distinguishes:

- **debt** (= ``agent.cost.token``) — the cost of *primary* LLM / tool calls
  that actually move a task forward.
- **tax** (= ``agent.cost.tax``) — the cost of every call that exists to
  service the agent's own machinery: retries, judges, guardrails, escalations,
  revalidations, monitors. Tax remains positive even when debt is minimised.

This module is the **shape**: a span-role classification, a per-task
:class:`CostBreakdown`, and a pure aggregator. It carries no I/O, no clock,
no behavioural override. Callers (the runner, the dashboard) read the
breakdown alongside the existing ``cost_cents`` totals; backward compat is
preserved by the field being :class:`Optional` everywhere.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from enum import Enum
from typing import Any

# Stable anchor — surfaced on the dashboard tooltip and in the runbook so
# downstream consumers can cite the methodology without re-fetching this
# docstring.
COST_DECOMPOSITION_ANCHOR = "§2605.27320"


class SpanRole(str, Enum):
    """Role classification for a single LLM or tool call.

    The seven values below are the canonical category list from the anchor
    paper. ``primary`` is the only role that contributes to ``debt``; every
    other role contributes to ``tax``.
    """

    PRIMARY = "primary"
    RETRY = "retry"
    JUDGE = "judge"
    GUARDRAIL = "guardrail"
    ESCALATION = "escalation"
    REVALIDATION = "revalidation"
    MONITOR = "monitor"

    @classmethod
    def parse(cls, raw: str | None) -> SpanRole:
        """Lenient parser — unknown / missing roles classify as ``primary``.

        We default to primary (debt) rather than raising so an older trace
        without `span_role` still produces an honest breakdown — it just
        looks like everything was forward progress. The dashboard surfaces
        the breakdown's source-confidence via the count of explicit roles.
        """
        if not raw:
            return cls.PRIMARY
        try:
            return cls(raw)
        except ValueError:
            return cls.PRIMARY

    @property
    def is_tax(self) -> bool:
        """True for any role that contributes to ``agent.cost.tax``."""
        return self is not SpanRole.PRIMARY


# Set form, kept as a frozen module-level constant so a caller that wants
# to enumerate the tax roles doesn't have to re-derive the set.
TAX_ROLES: frozenset[SpanRole] = frozenset(role for role in SpanRole if role.is_tax)


@dataclass(frozen=True)
class CallRecord:
    """One LLM or tool call with its role + cost.

    The shape stays minimal on purpose: the runner already records every
    other useful field (model, latency, tokens) on the parent
    :class:`fd_evals.task.EvalResult`; this struct only adds what the
    decomposition needs.
    """

    role: SpanRole
    cost_cents: float

    def to_dict(self) -> dict[str, Any]:
        return {"role": self.role.value, "cost_cents": self.cost_cents}

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> CallRecord:
        return cls(
            role=SpanRole.parse(data.get("role")),
            cost_cents=float(data.get("cost_cents", 0.0)),
        )


@dataclass(frozen=True)
class RoleRollup:
    """Per-role rollup recorded on a :class:`CostBreakdown`."""

    role: SpanRole
    cost_cents: float
    call_count: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "role": self.role.value,
            "cost_cents": round(self.cost_cents, 6),
            "call_count": self.call_count,
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> RoleRollup:
        return cls(
            role=SpanRole.parse(data.get("role")),
            cost_cents=float(data.get("cost_cents", 0.0)),
            call_count=int(data.get("call_count", 0)),
        )


@dataclass(frozen=True)
class CostBreakdown:
    """Per-task or per-run debt-vs-tax cost decomposition."""

    # `agent.cost.token` — sum of primary calls.
    token_cost_cents: float
    # `agent.cost.tax` — sum of every non-primary call.
    tax_cost_cents: float
    # Per-role rollups, sorted by role enum order for stable serialisation.
    by_role: tuple[RoleRollup, ...]
    # Stable anchor mirrored on the wire so audit consumers can cite the
    # methodology root.
    anchor: str = COST_DECOMPOSITION_ANCHOR

    @property
    def total_cost_cents(self) -> float:
        """`debt + tax`. Matches the existing per-task `cost_cents` when
        every recorded call has a role attached."""
        return self.token_cost_cents + self.tax_cost_cents

    @property
    def tax_share(self) -> float:
        """`tax / (token + tax)` ∈ `[0, 1]`.

        Returns `0.0` for an empty breakdown — absence of data must never
        render as "100% tax". A pure-tax task is a real signal; an empty
        task is not.
        """
        total = self.total_cost_cents
        if total <= 0:
            return 0.0
        return self.tax_cost_cents / total

    @property
    def is_tax_dominant(self) -> bool:
        """True when more than half of the cost is tax — the paper's
        "tax remains positive even when debt is minimized" signal."""
        return self.tax_share > 0.5

    def to_dict(self) -> dict[str, Any]:
        return {
            "token_cost_cents": round(self.token_cost_cents, 6),
            "tax_cost_cents": round(self.tax_cost_cents, 6),
            "total_cost_cents": round(self.total_cost_cents, 6),
            "tax_share": round(self.tax_share, 6),
            "is_tax_dominant": self.is_tax_dominant,
            "by_role": [r.to_dict() for r in self.by_role],
            "anchor": self.anchor,
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> CostBreakdown:
        rolls = tuple(RoleRollup.from_dict(r) for r in data.get("by_role", []))
        return cls(
            token_cost_cents=float(data.get("token_cost_cents", 0.0)),
            tax_cost_cents=float(data.get("tax_cost_cents", 0.0)),
            by_role=rolls,
            anchor=str(data.get("anchor", COST_DECOMPOSITION_ANCHOR)),
        )


def classify_calls(calls: Iterable[CallRecord | Mapping[str, Any]]) -> CostBreakdown:
    """Pure aggregator: roll up a sequence of call records into a breakdown.

    Accepts either typed :class:`CallRecord` instances or raw dicts — the
    runner can hand off either shape without an intermediate conversion.
    Empty input yields a zero-valued breakdown (not :class:`None`) so
    downstream code can treat the field uniformly.
    """
    by_role: dict[SpanRole, list[float]] = {role: [] for role in SpanRole}
    for call in calls:
        if isinstance(call, CallRecord):
            record = call
        else:
            record = CallRecord.from_dict(call)
        by_role[record.role].append(record.cost_cents)

    rollups: list[RoleRollup] = []
    token_total = 0.0
    tax_total = 0.0
    # Iterate by enum order so the rollup list is deterministic.
    for role in SpanRole:
        costs = by_role[role]
        if not costs:
            continue
        total = sum(costs)
        rollups.append(RoleRollup(role=role, cost_cents=total, call_count=len(costs)))
        if role is SpanRole.PRIMARY:
            token_total += total
        else:
            tax_total += total

    return CostBreakdown(
        token_cost_cents=token_total,
        tax_cost_cents=tax_total,
        by_role=tuple(rollups),
    )


def sum_breakdowns(breakdowns: Iterable[CostBreakdown | None]) -> CostBreakdown:
    """Aggregate per-task breakdowns into a run-level breakdown.

    `None` entries are skipped — they represent legacy task results that
    predate this PR. The aggregate is the sum of every concrete breakdown's
    role rollups; an empty input yields a zero-valued breakdown.
    """
    by_role: dict[SpanRole, tuple[float, int]] = {}
    for bd in breakdowns:
        if bd is None:
            continue
        for rr in bd.by_role:
            existing_cost, existing_count = by_role.get(rr.role, (0.0, 0))
            by_role[rr.role] = (
                existing_cost + rr.cost_cents,
                existing_count + rr.call_count,
            )

    rollups: list[RoleRollup] = []
    token_total = 0.0
    tax_total = 0.0
    for role in SpanRole:
        if role not in by_role:
            continue
        cost, count = by_role[role]
        rollups.append(RoleRollup(role=role, cost_cents=cost, call_count=count))
        if role is SpanRole.PRIMARY:
            token_total += cost
        else:
            tax_total += cost

    return CostBreakdown(
        token_cost_cents=token_total,
        tax_cost_cents=tax_total,
        by_role=tuple(rollups),
    )


def rank_tasks_by_tax_share(
    tasks: Iterable[tuple[str, CostBreakdown | None]],
) -> list[tuple[str, CostBreakdown]]:
    """Return `(task_id, breakdown)` pairs ordered by descending `tax_share`.

    Tasks without a breakdown are dropped — the dashboard never renders
    them in the tax-dominance ranking because there's no signal. The
    ranking is stable: ties break on `task_id` (lexicographic).
    """
    materialised = [(tid, bd) for tid, bd in tasks if bd is not None]
    materialised.sort(key=lambda pair: (-pair[1].tax_share, pair[0]))
    return materialised


@dataclass(frozen=True)
class TaskCostRow:
    """Convenience row shape for the dashboard ranking + Recharts series."""

    task_id: str
    task_name: str
    token_cost_cents: float
    tax_cost_cents: float
    tax_share: float
    is_tax_dominant: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "task_name": self.task_name,
            "token_cost_cents": round(self.token_cost_cents, 6),
            "tax_cost_cents": round(self.tax_cost_cents, 6),
            "tax_share": round(self.tax_share, 6),
            "is_tax_dominant": self.is_tax_dominant,
        }


def task_cost_rows(
    tasks: Iterable[tuple[str, str, CostBreakdown | None]],
) -> list[TaskCostRow]:
    """Project `(task_id, task_name, breakdown)` triples into dashboard rows.

    Tasks without a breakdown are emitted with zero costs + `tax_share = 0`
    so the dashboard can show every task in one table without a separate
    "unrecorded" bucket. The ranking is descending by `tax_share`.
    """
    rows: list[TaskCostRow] = []
    for tid, tname, bd in tasks:
        if bd is None:
            rows.append(
                TaskCostRow(
                    task_id=tid,
                    task_name=tname,
                    token_cost_cents=0.0,
                    tax_cost_cents=0.0,
                    tax_share=0.0,
                    is_tax_dominant=False,
                )
            )
            continue
        rows.append(
            TaskCostRow(
                task_id=tid,
                task_name=tname,
                token_cost_cents=bd.token_cost_cents,
                tax_cost_cents=bd.tax_cost_cents,
                tax_share=bd.tax_share,
                is_tax_dominant=bd.is_tax_dominant,
            )
        )
    rows.sort(key=lambda r: (-r.tax_share, r.task_id))
    return rows


# -----------------------------------------------------------------------------
# OTel attribute keys — mirrored from the Rust side `fd_otel::genai::attrs`
# so both planes agree on one wire shape. The Rust counterpart lives in
# `rust/crates/fd-otel/src/genai.rs`; keep these in sync.
# -----------------------------------------------------------------------------

FD_COST_ROLE = "ferrumdeck.cost.role"
FD_COST_TOKEN_CENTS = "ferrumdeck.cost.token_cents"
FD_COST_TAX_CENTS = "ferrumdeck.cost.tax_cents"
FD_COST_TAX_SHARE = "ferrumdeck.cost.tax_share"


def cost_breakdown_to_otel_attrs(bd: CostBreakdown) -> dict[str, Any]:
    """OTel attribute dict the runner / gateway can `span.set_attributes(...)`.

    Mirrors the Rust ``fd_otel::genai::span_helpers::record_cost_breakdown``
    helper — same keys, same value semantics, so a single span seen in
    Jaeger reads one schema regardless of which plane recorded it.
    """
    return {
        FD_COST_TOKEN_CENTS: round(bd.token_cost_cents, 6),
        FD_COST_TAX_CENTS: round(bd.tax_cost_cents, 6),
        FD_COST_TAX_SHARE: round(bd.tax_share, 6),
    }


__all__ = [
    "COST_DECOMPOSITION_ANCHOR",
    "CallRecord",
    "CostBreakdown",
    "FD_COST_ROLE",
    "FD_COST_TAX_CENTS",
    "FD_COST_TAX_SHARE",
    "FD_COST_TOKEN_CENTS",
    "RoleRollup",
    "SpanRole",
    "TAX_ROLES",
    "TaskCostRow",
    "classify_calls",
    "cost_breakdown_to_otel_attrs",
    "rank_tasks_by_tax_share",
    "sum_breakdowns",
    "task_cost_rows",
]
