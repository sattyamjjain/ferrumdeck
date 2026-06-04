"""Deterministic eval: champion-challenger promotion gate.

The spec requires exactly three things, all asserted here:

1. a challenger **below** threshold is DENIED promotion (stays shadow),
2. a challenger **above** threshold **and approved** is PROMOTED,
3. both decisions appear in the audit log.

The gate logic mirrors ``fd_policy::promotion::PromotionGate`` byte-for-byte;
the audit-log replay reuses the same ``promotion.decided`` action filter the
gateway's ``AuditRepo::list_promotion_decisions`` projection uses.

Anchor: champion-challenger promotion gate.
"""

from __future__ import annotations

from typing import Any

import pytest

from fd_evals.promotion import (
    DECISION_ALLOW,
    DECISION_DENY,
    DECISION_REQUIRES_APPROVAL,
    PROMOTION_ANCHOR,
    PROMOTION_AUDIT_ACTION,
    STATUS_AWAITING_APPROVAL,
    STATUS_DENIED,
    STATUS_PROMOTED,
    MetricThreshold,
    PromotionGateConfig,
    evaluate,
    extract_promotions_from_audit,
)

# The gate config under test: a challenger must clear an eval pass-rate floor
# of 0.90 and a bench-trust floor of 0.70, then collect a human approval.
GATE = PromotionGateConfig(
    thresholds=(
        MetricThreshold("eval_pass_rate", 0.90),
        MetricThreshold("bench_trust_score", 0.70),
    ),
    require_human_approval=True,
)


def _audit_event(
    decision_id: str, agent_id: str, evaluation: Any, **overrides: Any
) -> dict[str, Any]:
    """Build a synthetic `audit_events` row carrying a promotion decision.

    Shape matches what the gateway writes: `action = "promotion.decided"`,
    `resource_id = agent_id`, and the `PromotionDecision` JSON in `details`.
    """
    details = {
        "id": decision_id,
        "agent_id": agent_id,
        "champion_version_id": overrides.get("champion_version_id", "agv_champion"),
        "challenger_version_id": overrides.get("challenger_version_id", "agv_challenger"),
        "decision_kind": evaluation.decision_kind,
        "status": evaluation.status,
        "reason": evaluation.reason,
        "metric_evidence": [e.to_dict() for e in evaluation.metric_evidence],
        "approval_present": overrides.get("approval_present", False),
        "approval_required": GATE.require_human_approval,
        "anchor": PROMOTION_ANCHOR,
    }
    return {
        "id": f"aud_{decision_id}",
        "action": PROMOTION_AUDIT_ACTION,
        "resource_id": agent_id,
        "details": details,
    }


# ---------------------------------------------------------------------------
# 1. Below threshold → DENIED
# ---------------------------------------------------------------------------


class TestBelowThresholdDenied:
    def test_below_threshold_is_denied(self) -> None:
        # bench_trust_score is below its 0.70 floor.
        result = evaluate(
            GATE,
            {"eval_pass_rate": 0.95, "bench_trust_score": 0.55},
            approval_present=True,
        )
        assert result.decision_kind == DECISION_DENY
        assert result.status == STATUS_DENIED
        assert "bench_trust_score" in result.reason

    def test_missing_metric_is_denied(self) -> None:
        # bench_trust_score not reported at all → hard fail.
        result = evaluate(GATE, {"eval_pass_rate": 0.95}, approval_present=True)
        assert result.decision_kind == DECISION_DENY
        assert result.status == STATUS_DENIED

    def test_empty_thresholds_deny_by_default(self) -> None:
        empty = PromotionGateConfig(thresholds=(), require_human_approval=True)
        result = evaluate(empty, {"eval_pass_rate": 0.99}, approval_present=True)
        assert result.decision_kind == DECISION_DENY


# ---------------------------------------------------------------------------
# 2. Above threshold + approved → PROMOTED
# ---------------------------------------------------------------------------


class TestAboveThresholdPromoted:
    def test_above_threshold_with_approval_is_promoted(self) -> None:
        result = evaluate(
            GATE,
            {"eval_pass_rate": 0.96, "bench_trust_score": 0.82},
            approval_present=True,
        )
        assert result.decision_kind == DECISION_ALLOW
        assert result.status == STATUS_PROMOTED
        assert all(e.passed for e in result.metric_evidence)

    def test_above_threshold_without_approval_awaits_approval(self) -> None:
        result = evaluate(
            GATE,
            {"eval_pass_rate": 0.96, "bench_trust_score": 0.82},
            approval_present=False,
        )
        assert result.decision_kind == DECISION_REQUIRES_APPROVAL
        assert result.status == STATUS_AWAITING_APPROVAL

    def test_inclusive_floor_promotes_at_exact_threshold(self) -> None:
        result = evaluate(
            GATE,
            {"eval_pass_rate": 0.90, "bench_trust_score": 0.70},
            approval_present=True,
        )
        assert result.status == STATUS_PROMOTED


# ---------------------------------------------------------------------------
# 3. Both decisions appear in the audit log
# ---------------------------------------------------------------------------


class TestDecisionsInAuditLog:
    def test_both_decisions_land_in_audit_log(self) -> None:
        agent_id = "agt_demo"

        denied_eval = evaluate(
            GATE,
            {"eval_pass_rate": 0.95, "bench_trust_score": 0.55},
            approval_present=True,
        )
        promoted_eval = evaluate(
            GATE,
            {"eval_pass_rate": 0.96, "bench_trust_score": 0.82},
            approval_present=True,
        )

        # Synthetic audit stream — salted with an unrelated event so the
        # extractor's action filter is exercised, not trusted.
        audit_log: list[dict[str, Any]] = [
            {"id": "aud_unrelated", "action": "agent.updated", "details": {}},
            _audit_event(
                "prm_denied_001",
                agent_id,
                denied_eval,
                challenger_version_id="agv_challenger_weak",
                approval_present=True,
            ),
            _audit_event(
                "prm_promoted_001",
                agent_id,
                promoted_eval,
                challenger_version_id="agv_challenger_strong",
                approval_present=True,
            ),
        ]

        decisions = extract_promotions_from_audit(audit_log)

        # Exactly the two promotion decisions surface, not the unrelated row.
        assert len(decisions) == 2
        by_id = {d.id: d for d in decisions}

        denied = by_id["prm_denied_001"]
        assert denied.is_denied
        assert denied.decision_kind == DECISION_DENY
        assert denied.challenger_version_id == "agv_challenger_weak"

        promoted = by_id["prm_promoted_001"]
        assert promoted.is_promoted
        assert promoted.decision_kind == DECISION_ALLOW
        assert promoted.challenger_version_id == "agv_challenger_strong"
        # The promoted record carries the cleared evidence.
        assert all(e.passed for e in promoted.metric_evidence)

    def test_audit_round_trip_preserves_evidence(self) -> None:
        promoted_eval = evaluate(
            GATE,
            {"eval_pass_rate": 0.96, "bench_trust_score": 0.82},
            approval_present=True,
        )
        event = _audit_event("prm_rt_001", "agt_demo", promoted_eval, approval_present=True)
        [parsed] = extract_promotions_from_audit([event])

        assert parsed.id == "prm_rt_001"
        assert parsed.anchor == PROMOTION_ANCHOR
        assert len(parsed.metric_evidence) == 2
        ev = {e.name: e for e in parsed.metric_evidence}
        assert ev["eval_pass_rate"].measured_value == pytest.approx(0.96)
        assert ev["bench_trust_score"].passed

    def test_extractor_ignores_non_promotion_events(self) -> None:
        events = [
            {"id": "a1", "action": "run.created", "details": {}},
            {"id": "a2", "action": "routing.decided", "details": {}},
        ]
        assert extract_promotions_from_audit(events) == []
