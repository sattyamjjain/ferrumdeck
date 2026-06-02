"""Debt-vs-tax cost decomposition tests (§2605.27320).

Covers:

- Pure compute: classify_calls / sum_breakdowns / tax_share boundary.
- The "tax remains positive even when debt is minimized" fixture: one task
  whose tax cost dwarfs its primary cost.
- Backward compatibility: an :class:`EvalResult` without the new fields
  round-trips through `to_dict` without leaking new keys.
- Cross-plane OTel attribute keys match the Rust mirror.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from fd_evals.cost_decomposition import (
    COST_DECOMPOSITION_ANCHOR,
    FD_COST_ROLE,
    FD_COST_TAX_CENTS,
    FD_COST_TAX_SHARE,
    FD_COST_TOKEN_CENTS,
    CallRecord,
    CostBreakdown,
    SpanRole,
    classify_calls,
    cost_breakdown_to_otel_attrs,
    rank_tasks_by_tax_share,
    sum_breakdowns,
    task_cost_rows,
)
from fd_evals.task import EvalResult, ScorerResult

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "tax_dominance.json"


# ---------------------------------------------------------------------------
# SpanRole — the seven canonical categories
# ---------------------------------------------------------------------------


class TestSpanRole:
    def test_primary_is_the_only_debt_role(self) -> None:
        for role in SpanRole:
            assert role.is_tax == (role is not SpanRole.PRIMARY)

    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("primary", SpanRole.PRIMARY),
            ("retry", SpanRole.RETRY),
            ("judge", SpanRole.JUDGE),
            ("guardrail", SpanRole.GUARDRAIL),
            ("escalation", SpanRole.ESCALATION),
            ("revalidation", SpanRole.REVALIDATION),
            ("monitor", SpanRole.MONITOR),
        ],
    )
    def test_parse_round_trips_canonical_values(self, raw: str, expected: SpanRole) -> None:
        assert SpanRole.parse(raw) is expected

    @pytest.mark.parametrize("raw", [None, "", "unknown-role", "PRIMARY"])
    def test_parse_falls_back_to_primary_on_unknown(self, raw: str | None) -> None:
        # Unknown classifies as primary so a legacy trace without the role
        # tag still produces an honest debt-side reading.
        assert SpanRole.parse(raw) is SpanRole.PRIMARY


# ---------------------------------------------------------------------------
# Pure compute
# ---------------------------------------------------------------------------


class TestCostBreakdownCompute:
    def test_empty_call_list_yields_zero_breakdown(self) -> None:
        bd = classify_calls([])
        assert bd.token_cost_cents == 0.0
        assert bd.tax_cost_cents == 0.0
        assert bd.total_cost_cents == 0.0
        assert bd.tax_share == 0.0
        assert not bd.is_tax_dominant

    def test_all_primary_yields_zero_tax_share(self) -> None:
        bd = classify_calls(
            [
                CallRecord(SpanRole.PRIMARY, 1.5),
                CallRecord(SpanRole.PRIMARY, 2.5),
            ]
        )
        assert bd.token_cost_cents == 4.0
        assert bd.tax_cost_cents == 0.0
        assert bd.tax_share == 0.0

    def test_all_tax_yields_unit_tax_share(self) -> None:
        bd = classify_calls(
            [
                CallRecord(SpanRole.RETRY, 0.5),
                CallRecord(SpanRole.MONITOR, 1.0),
                CallRecord(SpanRole.GUARDRAIL, 0.5),
            ]
        )
        assert bd.token_cost_cents == 0.0
        assert bd.tax_cost_cents == 2.0
        assert bd.tax_share == 1.0
        assert bd.is_tax_dominant

    def test_mixed_breakdown_reports_fractional_tax_share(self) -> None:
        # 1 token + 3 tax → 0.75 tax_share.
        bd = classify_calls(
            [
                CallRecord(SpanRole.PRIMARY, 1.0),
                CallRecord(SpanRole.RETRY, 1.0),
                CallRecord(SpanRole.JUDGE, 1.0),
                CallRecord(SpanRole.REVALIDATION, 1.0),
            ]
        )
        assert bd.token_cost_cents == 1.0
        assert bd.tax_cost_cents == 3.0
        assert bd.tax_share == pytest.approx(0.75)
        assert bd.is_tax_dominant

    def test_classify_accepts_raw_dicts(self) -> None:
        # The runner can hand the aggregator a raw list of dicts straight
        # from a trace fixture without a typed conversion pass.
        bd = classify_calls(
            [
                {"role": "primary", "cost_cents": 2.0},
                {"role": "retry", "cost_cents": 1.0},
            ]
        )
        assert bd.token_cost_cents == 2.0
        assert bd.tax_cost_cents == 1.0

    def test_by_role_iteration_is_stable(self) -> None:
        bd = classify_calls(
            [
                CallRecord(SpanRole.MONITOR, 0.1),
                CallRecord(SpanRole.PRIMARY, 0.5),
                CallRecord(SpanRole.JUDGE, 0.2),
            ]
        )
        # Iteration order matches the SpanRole enum, not insertion order.
        observed_order = [r.role for r in bd.by_role]
        canonical_order = [SpanRole.PRIMARY, SpanRole.JUDGE, SpanRole.MONITOR]
        assert observed_order == canonical_order

    def test_round_trip_through_to_dict(self) -> None:
        bd = classify_calls(
            [
                CallRecord(SpanRole.PRIMARY, 1.0),
                CallRecord(SpanRole.RETRY, 0.5),
            ]
        )
        round_tripped = CostBreakdown.from_dict(bd.to_dict())
        assert round_tripped == bd

    def test_anchor_is_recorded_on_breakdown(self) -> None:
        bd = classify_calls([])
        assert bd.anchor == COST_DECOMPOSITION_ANCHOR

    def test_sum_breakdowns_ignores_none(self) -> None:
        a = classify_calls([CallRecord(SpanRole.PRIMARY, 1.0)])
        b = classify_calls([CallRecord(SpanRole.RETRY, 0.5)])
        agg = sum_breakdowns([a, None, b, None])
        assert agg.token_cost_cents == 1.0
        assert agg.tax_cost_cents == 0.5

    def test_sum_breakdowns_empty_input_yields_zero(self) -> None:
        agg = sum_breakdowns([None, None])
        assert agg.token_cost_cents == 0.0
        assert agg.tax_cost_cents == 0.0
        assert agg.tax_share == 0.0


# ---------------------------------------------------------------------------
# Tax-dominance fixture: same model, retry storm dwarfs primary cost
# ---------------------------------------------------------------------------


def _load_fixture() -> dict[str, Any]:
    with FIXTURE_PATH.open() as fh:
        return json.load(fh)


def _task_breakdown(fixture: dict[str, Any], task_id: str) -> CostBreakdown:
    task = next(t for t in fixture["task_results"] if t["task_id"] == task_id)
    return classify_calls(task["call_records"])


class TestTaxDominanceFixture:
    def test_demo_task_has_tax_dwarfing_token(self) -> None:
        """The headline §2605.27320 signal — tax dominates debt for a task
        even when the primary call costs almost nothing."""
        fixture = _load_fixture()
        bd = _task_breakdown(fixture, "task_002")

        assert bd.is_tax_dominant
        assert bd.tax_cost_cents > bd.token_cost_cents
        # The fixture pins ~$0.0010 token, ~$0.0095 tax → tax_share ≥ 0.85.
        assert bd.tax_share >= 0.85
        # Retry calls dominate the tax bucket.
        retry_total = sum(rr.cost_cents for rr in bd.by_role if rr.role is SpanRole.RETRY)
        assert retry_total > bd.token_cost_cents

    def test_debt_heavy_task_has_zero_or_low_tax_share(self) -> None:
        fixture = _load_fixture()
        bd = _task_breakdown(fixture, "task_001")
        assert not bd.is_tax_dominant
        assert bd.tax_share < 0.5

    def test_balanced_task_is_below_dominance_threshold(self) -> None:
        fixture = _load_fixture()
        bd = _task_breakdown(fixture, "task_003")
        # task_003: 0.014 primary + 0.008 tax → ~36% tax_share.
        assert not bd.is_tax_dominant
        assert 0.3 < bd.tax_share < 0.45

    def test_ranking_places_tax_dominant_task_first(self) -> None:
        fixture = _load_fixture()
        pairs = [(t["task_id"], classify_calls(t["call_records"])) for t in fixture["task_results"]]
        ranked = rank_tasks_by_tax_share(pairs)
        assert ranked[0][0] == "task_002"
        # task_003 has more tax_share than task_001 (debt-heavy).
        assert ranked[1][0] == "task_003"
        assert ranked[2][0] == "task_001"

    def test_run_level_aggregate_reflects_all_three_tasks(self) -> None:
        fixture = _load_fixture()
        per_task = [classify_calls(t["call_records"]) for t in fixture["task_results"]]
        agg = sum_breakdowns(per_task)
        # Sum of tokens across the three tasks: 0.0105 + 0.0010 + 0.014.
        assert agg.token_cost_cents == pytest.approx(0.0255)
        # Sum of tax: 0.0015 + 0.0095 + 0.008.
        assert agg.tax_cost_cents == pytest.approx(0.019)

    def test_task_cost_rows_ranks_descending(self) -> None:
        fixture = _load_fixture()
        triples = [
            (t["task_id"], t["task_name"], classify_calls(t["call_records"]))
            for t in fixture["task_results"]
        ]
        rows = task_cost_rows(triples)
        # First row is the tax-dominant task; share strictly decreases.
        assert rows[0].task_id == "task_002"
        assert rows[0].is_tax_dominant
        shares = [r.tax_share for r in rows]
        assert shares == sorted(shares, reverse=True)


# ---------------------------------------------------------------------------
# Backward compatibility — EvalResult round-trips cleanly without breakdown
# ---------------------------------------------------------------------------


class TestEvalResultBackwardCompat:
    def _result(self, **overrides: Any) -> EvalResult:
        base = {
            "task_id": "t1",
            "task_name": "Demo task",
            "run_id": "run_demo",
            "passed": True,
            "total_score": 1.0,
            "scorer_results": [
                ScorerResult(scorer_name="demo", passed=True, score=1.0, message="ok")
            ],
            "execution_time_ms": 100,
            "input_tokens": 100,
            "output_tokens": 50,
            "cost_cents": 0.5,
            "timestamp": datetime.now(tz=UTC),
        }
        base.update(overrides)
        return EvalResult(**base)

    def test_legacy_result_omits_new_keys(self) -> None:
        d = self._result().to_dict()
        assert "call_records" not in d
        assert "cost_breakdown" not in d

    def test_result_with_breakdown_emits_new_keys(self) -> None:
        bd = classify_calls(
            [
                CallRecord(SpanRole.PRIMARY, 0.4),
                CallRecord(SpanRole.RETRY, 0.1),
            ]
        )
        r = self._result(
            call_records=[
                CallRecord(SpanRole.PRIMARY, 0.4),
                CallRecord(SpanRole.RETRY, 0.1),
            ],
            cost_breakdown=bd,
        )
        d = r.to_dict()
        assert d["cost_breakdown"]["tax_share"] == pytest.approx(0.2)
        # Anchor mirrored verbatim on the wire.
        assert d["cost_breakdown"]["anchor"] == COST_DECOMPOSITION_ANCHOR
        assert d["call_records"][1]["role"] == "retry"


# ---------------------------------------------------------------------------
# Cross-plane OTel attribute keys
# ---------------------------------------------------------------------------


class TestOTelAttributeKeys:
    def test_keys_match_rust_constants_byte_for_byte(self) -> None:
        # Mirror of `rust/crates/fd-otel/src/genai.rs::attrs::FERRUMDECK_COST_*`.
        # If either side renames a key, this test fails and both sides must be
        # renegotiated together.
        assert FD_COST_ROLE == "ferrumdeck.cost.role"
        assert FD_COST_TOKEN_CENTS == "ferrumdeck.cost.token_cents"
        assert FD_COST_TAX_CENTS == "ferrumdeck.cost.tax_cents"
        assert FD_COST_TAX_SHARE == "ferrumdeck.cost.tax_share"

    def test_breakdown_to_otel_attrs_emits_three_rollup_keys(self) -> None:
        bd = classify_calls(
            [
                CallRecord(SpanRole.PRIMARY, 1.0),
                CallRecord(SpanRole.RETRY, 1.0),
            ]
        )
        attrs = cost_breakdown_to_otel_attrs(bd)
        assert set(attrs.keys()) == {
            FD_COST_TOKEN_CENTS,
            FD_COST_TAX_CENTS,
            FD_COST_TAX_SHARE,
        }
        assert attrs[FD_COST_TAX_SHARE] == pytest.approx(0.5)
