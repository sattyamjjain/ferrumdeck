"""Tests for eval-driven harness/policy delta derivation (trace->delta)."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fd_evals.harness_delta import (
    HARNESS_ANCHOR,
    HarnessDelta,
    HarnessDeltaConfig,
    HarnessDeltaEvidence,
    derive_harness_deltas,
)
from fd_evals.task import EvalRunSummary

FIXTURES = Path(__file__).parent / "fixtures"


def _summary(
    run_id: str, total_cost_cents: float, total_tasks: int, passed_tasks: int
) -> EvalRunSummary:
    return EvalRunSummary(
        run_id=run_id,
        dataset_name="ds",
        total_tasks=total_tasks,
        passed_tasks=passed_tasks,
        failed_tasks=total_tasks - passed_tasks,
        average_score=(passed_tasks / total_tasks) if total_tasks else 0.0,
        total_cost_cents=total_cost_cents,
        total_input_tokens=0,
        total_output_tokens=0,
        total_execution_time_ms=0,
        results=[],
        started_at=datetime.now(UTC),
    )


class TestBudgetRule:
    def test_budget_delta_fires_above_breach_threshold(self) -> None:
        # 7 of 10 runs over a 100-cent cap -> breach rate 0.7 >= 0.5.
        runs = [
            _summary(f"r{i}", cost, 1, 1)
            for i, cost in enumerate([150, 220, 90, 310, 80, 140, 175, 60, 200, 130])
        ]
        cfg = HarnessDeltaConfig(agent_id="agt_demo", per_run_cap_cents=100)
        deltas = derive_harness_deltas(runs, cfg)
        budget = [d for d in deltas if d.kind == "budget"]
        assert len(budget) == 1
        d = budget[0]
        assert d.proposed["per_run_cap_cents"] == 80.0  # 100 * 0.8
        assert d.confidence == 0.7
        assert d.source_eval_run_id == "r9"
        assert d.evidence[0].code == "budget_breach_rate"
        assert d.evidence[0].observed == 0.7

    def test_no_budget_delta_below_threshold(self) -> None:
        # Only 2 of 10 over the cap -> 0.2 < 0.5.
        runs = [
            _summary(f"r{i}", cost, 1, 1)
            for i, cost in enumerate([150, 220, 90, 50, 80, 40, 30, 60, 20, 70])
        ]
        cfg = HarnessDeltaConfig(agent_id="agt_demo", per_run_cap_cents=100)
        deltas = derive_harness_deltas(runs, cfg)
        assert [d for d in deltas if d.kind == "budget"] == []

    def test_budget_rule_skipped_without_cap(self) -> None:
        runs = [_summary(f"r{i}", 9999, 1, 1) for i in range(5)]
        cfg = HarnessDeltaConfig(agent_id="agt_demo", per_run_cap_cents=None)
        assert [d for d in derive_harness_deltas(runs, cfg) if d.kind == "budget"] == []


class TestPolicyRule:
    def test_policy_delta_fires_on_low_pass_rate(self) -> None:
        # 1/5 tasks pass aggregate -> 0.2 < 0.7 floor.
        runs = [_summary(f"r{i}", 10, 1, 1 if i == 0 else 0) for i in range(5)]
        cfg = HarnessDeltaConfig(agent_id="agt_demo", min_pass_rate=0.7)
        deltas = derive_harness_deltas(runs, cfg)
        policy = [d for d in deltas if d.kind == "policy"]
        assert len(policy) == 1
        assert policy[0].proposed == {"require_approval": True}
        assert policy[0].evidence[0].code == "low_pass_rate"
        assert abs(policy[0].confidence - 0.8) < 1e-9

    def test_no_policy_delta_when_pass_rate_healthy(self) -> None:
        runs = [_summary(f"r{i}", 10, 1, 1) for i in range(5)]
        cfg = HarnessDeltaConfig(agent_id="agt_demo", min_pass_rate=0.7)
        assert [d for d in derive_harness_deltas(runs, cfg) if d.kind == "policy"] == []


class TestGuards:
    def test_too_few_runs_yields_nothing(self) -> None:
        runs = [_summary("r0", 9999, 1, 0)]
        cfg = HarnessDeltaConfig(agent_id="agt_demo", per_run_cap_cents=100, min_runs=3)
        assert derive_harness_deltas(runs, cfg) == []

    def test_empty_yields_nothing(self) -> None:
        cfg = HarnessDeltaConfig(agent_id="agt_demo", per_run_cap_cents=100)
        assert derive_harness_deltas([], cfg) == []


class TestWireShape:
    def test_to_create_request_matches_gateway_dto(self) -> None:
        delta = HarnessDelta(
            agent_id="agt_demo",
            kind="budget",
            current={"per_run_cap_cents": 100},
            proposed={"per_run_cap_cents": 80},
            reason="too expensive",
            evidence=[HarnessDeltaEvidence("budget_breach_rate", "7/10 over cap", 0.7)],
            confidence=0.7,
            source_eval_run_id="run_10",
        )
        body = delta.to_create_request()
        assert set(body) == {
            "agent_id",
            "source_eval_run_id",
            "kind",
            "current",
            "proposed",
            "reason",
            "evidence",
            "confidence",
        }
        assert body["kind"] == "budget"
        assert body["evidence"] == [
            {"code": "budget_breach_rate", "detail": "7/10 over cap", "observed": 0.7}
        ]

    def test_anchor_value(self) -> None:
        assert HARNESS_ANCHOR == "harnessx-trace-to-delta"


class TestFixture:
    def test_window_fixture_drives_a_budget_delta(self) -> None:
        data: dict[str, Any] = json.loads((FIXTURES / "harness_delta_window.json").read_text())
        runs = [
            _summary(r["run_id"], r["total_cost_cents"], r["total_tasks"], r["passed_tasks"])
            for r in data["runs"]
        ]
        cfg = HarnessDeltaConfig(
            agent_id=data["agent_id"], per_run_cap_cents=data["per_run_cap_cents"]
        )
        deltas = derive_harness_deltas(runs, cfg)
        budget = [d for d in deltas if d.kind == "budget"]
        assert len(budget) == 1
        assert budget[0].evidence[0].observed == 0.7
