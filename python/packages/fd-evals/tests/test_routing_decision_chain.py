"""Deterministic eval: routing-decision chain is complete and hash-consistent.

This test ships the **coordination-heavy** coverage path the spec asks for:
synthetic audit-event stream describing a multi-agent run → chain extraction
via :func:`fd_evals.routing.extract_chain_from_audit` → completeness +
hash-consistency check via :func:`fd_evals.routing.verify_chain`. The
pinned cross-plane hash (also asserted by the Rust integration test
``rust/crates/fd-policy/tests/routing_hash_export.rs``) guards against any
silent drift between the Rust governance plane and the Python eval plane.

Anchor: AgensFlow ([arXiv:2605.27466](https://arxiv.org/abs/2605.27466)).
"""

from __future__ import annotations

from typing import Any

import pytest

from fd_evals.routing import (
    ROUTING_ANCHOR,
    ROUTING_AUDIT_ACTION,
    RoutingCandidate,
    RoutingChoice,
    RoutingDecision,
    RoutingReason,
    extract_chain_from_audit,
    verify_chain,
)

# Cross-plane pinned hash — produced by the Rust integration test in
# `rust/crates/fd-policy/tests/routing_hash_export.rs::fixture_hash_is_pinned`.
# Any change to either side that breaks this equality is coordination drift
# and the eval must fail until both sides are renegotiated together.
PINNED_FIXTURE_HASH = "b24284a106e28a41f408a96694ca410772719bc9d5dcc23f629707c75dfe4410"


def _fixture_decision() -> RoutingDecision:
    """Mirrors the Rust ``fixture()`` helper byte-for-byte."""
    return RoutingDecision(
        id="rtg_fixture_001",
        run_id="run_fixture_001",
        subtask_id="stp_planner_001",
        candidates=(
            RoutingCandidate(
                role="planner",
                model="claude-opus-4-7",
                agent_id="agt_plan_alpha",
                score=0.91,
            ),
            RoutingCandidate(
                role="planner",
                model="gpt-4o",
                agent_id="agt_plan_beta",
                score=0.74,
            ),
        ),
        chosen=RoutingChoice(role="planner", model="claude-opus-4-7", agent_id="agt_plan_alpha"),
        reason=RoutingReason(code="policy_match", detail="policy planner.default fired"),
        content_hash=PINNED_FIXTURE_HASH,
        decided_at="2023-11-14T22:13:20Z",
        anchor=ROUTING_ANCHOR,
    )


def _coordination_workflow_audit() -> list[dict[str, Any]]:
    """Synthetic audit-event stream for a three-step multi-agent workflow.

    Each step exercises a different :class:`RoutingReasonCode` so the eval
    covers the realistic dispatch surface (policy match, budget pass-through,
    fallback default) in one pass.
    """
    decisions = [
        _fixture_decision(),
        RoutingDecision(
            id="rtg_fixture_002",
            run_id="run_fixture_001",
            subtask_id="stp_researcher_001",
            candidates=(
                RoutingCandidate(
                    role="researcher",
                    model="claude-sonnet-4-6",
                    agent_id="agt_research_default",
                ),
            ),
            chosen=RoutingChoice(
                role="researcher",
                model="claude-sonnet-4-6",
                agent_id="agt_research_default",
            ),
            reason=RoutingReason(
                code="budget_within_limits", detail="all budget axes within limits"
            ),
            content_hash="",  # filled below
            decided_at="2023-11-14T22:14:00Z",
        ),
        RoutingDecision(
            id="rtg_fixture_003",
            run_id="run_fixture_001",
            subtask_id="stp_coder_001",
            candidates=(RoutingCandidate(role="coder", model="claude-opus-4-7"),),
            chosen=RoutingChoice(role="coder", model="claude-opus-4-7"),
            reason=RoutingReason(
                code="fallback_default",
                detail="workflow-declared default binding (no ranker engaged)",
            ),
            content_hash="",  # filled below
            decided_at="2023-11-14T22:14:30Z",
        ),
    ]

    # Stamp each decision's content_hash with its own expected projection so
    # the chain is self-consistent.
    stamped = []
    for d in decisions:
        if d.content_hash:
            stamped.append(d)
            continue
        stamped.append(
            RoutingDecision(
                id=d.id,
                run_id=d.run_id,
                subtask_id=d.subtask_id,
                candidates=d.candidates,
                chosen=d.chosen,
                reason=d.reason,
                content_hash=d.expected_hash(),
                decided_at=d.decided_at,
                anchor=d.anchor,
            )
        )

    events: list[dict[str, Any]] = []
    # Salt the stream with non-routing audit events so the extractor's
    # filter is exercised, not just trusted.
    events.append(
        {
            "id": "aud_unrelated_001",
            "action": "run.created",
            "details": {"run_id": "run_fixture_001"},
        }
    )
    for d in stamped:
        events.append(
            {
                "id": f"aud_{d.id}",
                "action": ROUTING_AUDIT_ACTION,
                "details": {
                    "id": d.id,
                    "run_id": d.run_id,
                    "subtask_id": d.subtask_id,
                    "candidates": [c.to_dict() for c in d.candidates],
                    "chosen": d.chosen.to_dict(),
                    "reason": {"code": d.reason.code, "detail": d.reason.detail},
                    "content_hash": d.content_hash,
                    "decided_at": d.decided_at,
                    "anchor": d.anchor,
                },
            }
        )
    events.append(
        {
            "id": "aud_unrelated_002",
            "action": "policy.denied",
            "details": {"run_id": "run_fixture_001"},
        }
    )
    return events


# ---------------------------------------------------------------------------
# Cross-plane hash pin
# ---------------------------------------------------------------------------


class TestCrossPlaneHash:
    def test_python_hash_matches_rust_pin(self) -> None:
        fixture = _fixture_decision()
        assert fixture.expected_hash() == PINNED_FIXTURE_HASH, (
            "Python `RoutingDecision.expected_hash` drifted from the Rust "
            "fd_policy::routing pin. Renegotiate the hash contract in both "
            "planes together before re-blessing."
        )

    def test_fixture_verify_hash_passes(self) -> None:
        assert _fixture_decision().verify_hash()


# ---------------------------------------------------------------------------
# Chain extraction + verification
# ---------------------------------------------------------------------------


class TestChainExtraction:
    def test_extract_filters_by_audit_action(self) -> None:
        events = _coordination_workflow_audit()
        chain = extract_chain_from_audit(events)
        assert [d.id for d in chain] == [
            "rtg_fixture_001",
            "rtg_fixture_002",
            "rtg_fixture_003",
        ], "extractor must pick up only routing.decided events, in order"

    def test_coordination_workflow_chain_is_complete_and_consistent(self) -> None:
        events = _coordination_workflow_audit()
        chain = extract_chain_from_audit(events)
        report = verify_chain(
            chain,
            expected_subtask_ids=[
                "stp_planner_001",
                "stp_researcher_001",
                "stp_coder_001",
            ],
        )
        assert report.is_complete, f"missing subtasks: {report.missing_subtasks}"
        assert report.is_hash_consistent, f"drifted decisions: {report.drifted_ids}"
        assert len(report.decisions) == 3

    def test_drifted_decision_is_flagged(self) -> None:
        events = _coordination_workflow_audit()
        # Tamper with the second decision's `chosen.model` AFTER the hash is
        # stamped — simulates an on-disk record drifting from its hash.
        for ev in events:
            if ev.get("details", {}).get("id") == "rtg_fixture_002":
                ev["details"]["chosen"]["model"] = "gpt-4o"
                break
        chain = extract_chain_from_audit(events)
        report = verify_chain(chain)
        assert report.drifted_ids == ("rtg_fixture_002",), (
            f"expected exactly the tampered decision to drift, got {report.drifted_ids}"
        )

    def test_missing_subtask_reported(self) -> None:
        events = _coordination_workflow_audit()
        chain = extract_chain_from_audit(events)
        report = verify_chain(
            chain,
            expected_subtask_ids=[
                "stp_planner_001",
                "stp_researcher_001",
                "stp_coder_001",
                "stp_reviewer_001",  # never dispatched
            ],
        )
        assert not report.is_complete
        assert "stp_reviewer_001" in report.missing_subtasks


# ---------------------------------------------------------------------------
# Defensive parsing
# ---------------------------------------------------------------------------


class TestDefensiveParsing:
    def test_unknown_reason_code_rejected(self) -> None:
        with pytest.raises(ValueError, match="unknown routing reason code"):
            RoutingDecision.from_audit_details(
                {
                    "id": "rtg_bad",
                    "run_id": "run_x",
                    "subtask_id": "stp_x",
                    "candidates": [],
                    "chosen": {"role": "x", "model": "y"},
                    "reason": {"code": "wat", "detail": "nope"},
                    "content_hash": "0" * 64,
                    "decided_at": "2025-01-01T00:00:00Z",
                    "anchor": ROUTING_ANCHOR,
                }
            )

    def test_unrelated_audit_events_ignored(self) -> None:
        events = [
            {"id": "a1", "action": "run.created", "details": {}},
            {"id": "a2", "action": "policy.denied", "details": {}},
        ]
        chain = extract_chain_from_audit(events)
        assert chain == []
