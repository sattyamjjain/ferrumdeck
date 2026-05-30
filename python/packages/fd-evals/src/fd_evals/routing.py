"""Routing-decision audit replay — Python projection.

Mirrors the Rust ``fd_policy::routing::RoutingDecision`` shape so fd-evals can
verify a coordination chain end-to-end against the same hash contract the
gateway writes into ``audit_events.details``. Anchor: AgensFlow
([arXiv:2605.27466](https://arxiv.org/abs/2605.27466)).

The compute is deterministic and pure. Same inputs → same content hash, on
every machine, on every CI run.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

ROUTING_ANCHOR = "arXiv:2605.27466"

# Audit-action filter used by the gateway's
# `AuditRepo::list_routing_decisions` projection. Mirrored here so the
# eval-plane replay reads the same row set without re-hitting the gateway.
ROUTING_AUDIT_ACTION = "routing.decided"

# Stable set of reason codes — `RoutingReasonCode` (Rust, snake_case
# serialised). The hash projection only consumes the *code*; the
# human-readable ``detail`` is recorded but does not affect drift detection.
_VALID_REASON_CODES = frozenset(
    {
        "policy_match",
        "budget_within_limits",
        "approval_gate",
        "skip",
        "fallback_default",
    }
)


@dataclass(frozen=True)
class RoutingCandidate:
    role: str
    model: str
    agent_id: str | None = None
    score: float | None = None

    def to_dict(self) -> dict[str, Any]:
        """Emit fields in the Rust struct-declaration order so the JSON
        bytes match `serde_json::to_vec` byte-for-byte — the hash projection
        depends on this. Optional fields use the same skip-if-None semantics
        as `#[serde(skip_serializing_if = "Option::is_none")]`."""
        out: dict[str, Any] = {"role": self.role}
        if self.agent_id is not None:
            out["agent_id"] = self.agent_id
        out["model"] = self.model
        if self.score is not None:
            out["score"] = self.score
        return out


@dataclass(frozen=True)
class RoutingChoice:
    role: str
    model: str
    agent_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Same field-order contract as :meth:`RoutingCandidate.to_dict`."""
        out: dict[str, Any] = {"role": self.role}
        if self.agent_id is not None:
            out["agent_id"] = self.agent_id
        out["model"] = self.model
        return out


@dataclass(frozen=True)
class RoutingReason:
    code: str
    detail: str


@dataclass(frozen=True)
class RoutingDecision:
    """Python mirror of the Rust ``RoutingDecision`` audit record."""

    id: str
    run_id: str
    subtask_id: str
    candidates: tuple[RoutingCandidate, ...]
    chosen: RoutingChoice
    reason: RoutingReason
    content_hash: str
    decided_at: str
    anchor: str = ROUTING_ANCHOR

    @classmethod
    def from_audit_details(cls, details: dict[str, Any]) -> RoutingDecision:
        """Parse a decision out of an ``audit_events.details`` blob."""
        if details.get("reason", {}).get("code") not in _VALID_REASON_CODES:
            raise ValueError(
                f"unknown routing reason code: {details.get('reason', {}).get('code')!r}"
            )
        candidates = tuple(
            RoutingCandidate(
                role=c["role"],
                model=c["model"],
                agent_id=c.get("agent_id"),
                score=c.get("score"),
            )
            for c in details.get("candidates", [])
        )
        chosen_raw = details["chosen"]
        chosen = RoutingChoice(
            role=chosen_raw["role"],
            model=chosen_raw["model"],
            agent_id=chosen_raw.get("agent_id"),
        )
        reason_raw = details["reason"]
        reason = RoutingReason(code=reason_raw["code"], detail=reason_raw["detail"])
        return cls(
            id=details["id"],
            run_id=details["run_id"],
            subtask_id=details["subtask_id"],
            candidates=candidates,
            chosen=chosen,
            reason=reason,
            content_hash=details["content_hash"],
            decided_at=details["decided_at"],
            anchor=details.get("anchor", ROUTING_ANCHOR),
        )

    def expected_hash(self) -> str:
        """Re-compute the hash from the structural fields. Mirrors the Rust
        ``compute_content_hash`` projection byte-for-byte."""
        projection = {
            "run_id": self.run_id,
            "subtask_id": self.subtask_id,
            "candidates": [c.to_dict() for c in self.candidates],
            "chosen": self.chosen.to_dict(),
            "reason_code": self.reason.code,
        }
        # `serde_json::to_vec` for the Rust HashableProjection emits fields in
        # struct-declaration order — we mirror that with an explicit OrderedDict
        # by relying on Python 3.7+ dict-insertion order, which matches the
        # field order above.
        encoded = json.dumps(projection, separators=(",", ":"), ensure_ascii=False)
        return hashlib.sha256(encoded.encode("utf-8")).hexdigest()

    def verify_hash(self) -> bool:
        """True iff the stored hash still matches the recomputed projection."""
        return self.expected_hash() == self.content_hash


@dataclass(frozen=True)
class RoutingChainReport:
    """Outcome of verifying a routing-decision chain."""

    decisions: tuple[RoutingDecision, ...]
    drifted_ids: tuple[str, ...] = field(default_factory=tuple)
    missing_subtasks: tuple[str, ...] = field(default_factory=tuple)

    @property
    def is_complete(self) -> bool:
        """True iff no expected subtask is missing a decision."""
        return not self.missing_subtasks

    @property
    def is_hash_consistent(self) -> bool:
        """True iff every decision's stored hash matches the projection."""
        return not self.drifted_ids


def extract_chain_from_audit(audit_events: Iterable[dict[str, Any]]) -> list[RoutingDecision]:
    """Filter an audit-event stream down to routing decisions and parse them.

    Mirrors the gateway's `AuditRepo::list_routing_decisions` projection
    semantically — the eval plane can re-run the same filter on a replay
    fixture without round-tripping through Postgres.
    """
    out: list[RoutingDecision] = []
    for event in audit_events:
        if event.get("action") != ROUTING_AUDIT_ACTION:
            continue
        details = event.get("details") or {}
        if not isinstance(details, dict):
            continue
        out.append(RoutingDecision.from_audit_details(details))
    return out


def verify_chain(
    decisions: Iterable[RoutingDecision],
    *,
    expected_subtask_ids: Iterable[str] | None = None,
) -> RoutingChainReport:
    """Verify a routing-decision chain for hash consistency and completeness.

    Hash consistency: every decision's stored ``content_hash`` must equal the
    SHA-256 of its structural fields. A mismatch is a coordination drift the
    eval should surface.

    Completeness: when ``expected_subtask_ids`` is supplied, every id in the
    expected set must appear as a ``subtask_id`` on at least one decision in
    the chain. Missing ids are reported on the returned
    :class:`RoutingChainReport`.
    """
    decisions_tuple = tuple(decisions)
    drifted: list[str] = []
    for d in decisions_tuple:
        if not d.verify_hash():
            drifted.append(d.id)

    missing: list[str] = []
    if expected_subtask_ids is not None:
        recorded = {d.subtask_id for d in decisions_tuple}
        for sid in expected_subtask_ids:
            if sid not in recorded:
                missing.append(sid)

    return RoutingChainReport(
        decisions=decisions_tuple,
        drifted_ids=tuple(drifted),
        missing_subtasks=tuple(missing),
    )


__all__ = [
    "ROUTING_ANCHOR",
    "ROUTING_AUDIT_ACTION",
    "RoutingCandidate",
    "RoutingChainReport",
    "RoutingChoice",
    "RoutingDecision",
    "RoutingReason",
    "extract_chain_from_audit",
    "verify_chain",
]
