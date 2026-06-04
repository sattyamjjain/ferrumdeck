"""Champion-challenger promotion-gate replay — Python projection.

Mirrors the Rust ``fd_policy::promotion`` shape so fd-evals can verify, in a
deterministic test, that the promotion gate behaves correctly end-to-end:

- a challenger **below** threshold is DENIED promotion (stays shadow),
- a challenger **above** threshold **and approved** is PROMOTED,
- and both decisions land in the immutable audit log.

The gate logic here is a pure mirror of the Rust decision table. It reads the
same ``audit_events.details`` JSON the gateway writes, filtered by the same
``promotion.decided`` action, so the eval plane never re-implements the wire
contract — it re-derives it.

Anchor: champion-challenger promotion gate.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

PROMOTION_ANCHOR = "champion-challenger"

# Audit-action filter used by the gateway's
# ``AuditRepo::list_promotion_decisions`` projection. Mirrored here so the
# eval-plane replay reads the same row set without re-hitting the gateway.
PROMOTION_AUDIT_ACTION = "promotion.decided"

# Policy-decision kinds, snake_case, mirroring `fd_policy::PolicyDecisionKind`.
DECISION_ALLOW = "allow"
DECISION_DENY = "deny"
DECISION_REQUIRES_APPROVAL = "requires_approval"
DECISION_ALLOW_WITH_WARNING = "allow_with_warning"

# Lifecycle statuses, mirroring `fd_policy::promotion::PromotionStatus`.
STATUS_SHADOW = "shadow"
STATUS_PROMOTED = "promoted"
STATUS_DENIED = "denied"
STATUS_AWAITING_APPROVAL = "awaiting_approval"


@dataclass(frozen=True)
class MetricThreshold:
    """A configurable metric floor the challenger must clear (inclusive)."""

    name: str
    min_value: float


@dataclass(frozen=True)
class PromotionGateConfig:
    """Gate config: thresholds + whether a human approval is required."""

    thresholds: tuple[MetricThreshold, ...] = ()
    require_human_approval: bool = True


@dataclass(frozen=True)
class MetricEvidence:
    """Per-metric outcome recorded as evidence on a decision."""

    name: str
    min_value: float
    measured_value: float | None
    passed: bool

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"name": self.name, "min_value": self.min_value}
        if self.measured_value is not None:
            out["measured_value"] = self.measured_value
        out["passed"] = self.passed
        return out


@dataclass(frozen=True)
class PromotionDecision:
    """Python mirror of the Rust ``PromotionDecision`` audit record."""

    id: str
    agent_id: str
    challenger_version_id: str
    decision_kind: str
    status: str
    reason: str
    metric_evidence: tuple[MetricEvidence, ...]
    approval_present: bool
    approval_required: bool
    champion_version_id: str | None = None
    anchor: str = PROMOTION_ANCHOR

    @property
    def is_promoted(self) -> bool:
        return self.status == STATUS_PROMOTED

    @property
    def is_denied(self) -> bool:
        return self.status == STATUS_DENIED

    @classmethod
    def from_audit_details(cls, details: Mapping[str, Any]) -> PromotionDecision:
        """Parse a decision out of an ``audit_events.details`` blob."""
        evidence = tuple(
            MetricEvidence(
                name=e["name"],
                min_value=float(e["min_value"]),
                measured_value=(
                    float(e["measured_value"]) if e.get("measured_value") is not None else None
                ),
                passed=bool(e["passed"]),
            )
            for e in details.get("metric_evidence", [])
        )
        return cls(
            id=details["id"],
            agent_id=details["agent_id"],
            champion_version_id=details.get("champion_version_id"),
            challenger_version_id=details["challenger_version_id"],
            decision_kind=details["decision_kind"],
            status=details["status"],
            reason=details["reason"],
            metric_evidence=evidence,
            approval_present=bool(details["approval_present"]),
            approval_required=bool(details["approval_required"]),
            anchor=details.get("anchor", PROMOTION_ANCHOR),
        )


@dataclass
class PromotionEvaluation:
    """Result of a gate evaluation: the policy-decision kind + lifecycle."""

    decision_kind: str
    status: str
    reason: str
    metric_evidence: list[MetricEvidence] = field(default_factory=list)


def _build_evidence(
    config: PromotionGateConfig, metrics: Mapping[str, float]
) -> list[MetricEvidence]:
    """Per-metric evidence in config order. A missing metric is a hard fail —
    the gate cannot assume an unreported metric succeeded."""
    evidence: list[MetricEvidence] = []
    for t in config.thresholds:
        measured = metrics.get(t.name)
        passed = measured is not None and measured >= t.min_value
        evidence.append(
            MetricEvidence(
                name=t.name,
                min_value=t.min_value,
                measured_value=measured,
                passed=passed,
            )
        )
    return evidence


def evaluate(
    config: PromotionGateConfig,
    metrics: Mapping[str, float],
    approval_present: bool,
) -> PromotionEvaluation:
    """Pure mirror of ``fd_policy::promotion::PromotionGate::evaluate``.

    Decision table (deny-by-default):
    - empty thresholds → deny (no evidence ⇒ no auto-promotion),
    - any threshold fails (or its metric is missing) → deny,
    - all pass, approval required but absent → requires_approval,
    - all pass, (approval not required, or present) → allow.
    """
    evidence = _build_evidence(config, metrics)

    if not config.thresholds:
        return PromotionEvaluation(
            decision_kind=DECISION_DENY,
            status=STATUS_DENIED,
            reason=(
                "promotion denied: no metric thresholds configured "
                "(deny-by-default; challenger stays shadow)"
            ),
            metric_evidence=evidence,
        )

    failed = [e for e in evidence if not e.passed]
    if failed:
        names = ", ".join(e.name for e in failed)
        return PromotionEvaluation(
            decision_kind=DECISION_DENY,
            status=STATUS_DENIED,
            reason=(
                f"promotion denied: challenger below threshold on [{names}] "
                "(challenger stays shadow)"
            ),
            metric_evidence=evidence,
        )

    if config.require_human_approval and not approval_present:
        return PromotionEvaluation(
            decision_kind=DECISION_REQUIRES_APPROVAL,
            status=STATUS_AWAITING_APPROVAL,
            reason="promotion thresholds cleared; awaiting required human approval before promote",
            metric_evidence=evidence,
        )

    return PromotionEvaluation(
        decision_kind=DECISION_ALLOW,
        status=STATUS_PROMOTED,
        reason=(
            "promotion allowed: all thresholds cleared and approval satisfied — "
            "challenger promoted to champion"
        ),
        metric_evidence=evidence,
    )


def extract_promotions_from_audit(
    audit_events: Iterable[Mapping[str, Any]],
) -> list[PromotionDecision]:
    """Filter an audit-event stream to promotion decisions and parse them.

    Mirrors the gateway's ``AuditRepo::list_promotion_decisions`` projection
    semantically — the eval plane re-runs the same filter on a replay fixture
    without round-tripping through Postgres.
    """
    out: list[PromotionDecision] = []
    for event in audit_events:
        if event.get("action") != PROMOTION_AUDIT_ACTION:
            continue
        details = event.get("details") or {}
        if not isinstance(details, dict):
            continue
        out.append(PromotionDecision.from_audit_details(details))
    return out


__all__ = [
    "DECISION_ALLOW",
    "DECISION_ALLOW_WITH_WARNING",
    "DECISION_DENY",
    "DECISION_REQUIRES_APPROVAL",
    "PROMOTION_ANCHOR",
    "PROMOTION_AUDIT_ACTION",
    "STATUS_AWAITING_APPROVAL",
    "STATUS_DENIED",
    "STATUS_PROMOTED",
    "STATUS_SHADOW",
    "MetricEvidence",
    "MetricThreshold",
    "PromotionDecision",
    "PromotionEvaluation",
    "PromotionGateConfig",
    "evaluate",
    "extract_promotions_from_audit",
]
