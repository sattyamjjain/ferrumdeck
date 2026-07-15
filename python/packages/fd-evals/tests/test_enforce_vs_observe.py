"""Tests for the observability blind-spot benchmark.

Deterministic + offline: runs one AgentDojo-style injection trace through both
lanes and asserts the record-after vs decide-before contrast on the *real*
captured spans (in-memory exporter). The gate verdict comes from the
corpus-pinned ``injection_defense.decide`` (mirrors the Rust ``fd_policy``
contract), so this test also guards cross-plane parity of the decision.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fd_runtime.tracing import FD_DECISION, GEN_AI_TOOL_NAME

from fd_evals.enforce_vs_observe import (
    ENFORCE_VS_OBSERVE_ANCHOR,
    Comparison,
    assert_contrast,
    render_report,
    run_comparison,
)

CORPUS = Path(__file__).resolve().parents[4] / "evals" / "datasets" / "injection_defense"


@pytest.fixture(scope="module")
def cmp() -> Comparison:
    return run_comparison(CORPUS, "atk_unauth_01")


class TestBlindSpotContrast:
    def test_contrast_holds(self, cmp: Comparison) -> None:
        # The whole artifact's claim, self-checked.
        assert_contrast(cmp)

    def test_observe_only_records_after_no_decision(self, cmp: Comparison) -> None:
        o = cmp.observe_only
        # A record-only stack lets the call run and carries no enforcement decision.
        assert o.executed is True
        assert o.decision is None
        assert not o.has_decision
        assert FD_DECISION not in o.attributes
        # It still emits a GenAI tool span naming the tool (post-hoc record).
        assert o.attributes.get(GEN_AI_TOOL_NAME) == cmp.tool_name

    def test_in_path_gate_denies_before_execution(self, cmp: Comparison) -> None:
        g = cmp.in_path_gate
        assert g.decision == "deny"
        assert g.executed is False
        assert g.attributes.get(FD_DECISION) == "deny"
        # The deny rides the same GenAI tool span (same name as the record-only lane).
        assert g.span_name == cmp.observe_only.span_name
        assert g.attributes.get(GEN_AI_TOOL_NAME) == cmp.tool_name

    def test_gate_matches_corpus_ground_truth(self, cmp: Comparison) -> None:
        # The case is an attack: it must not execute, and the gate agrees.
        assert cmp.expected_executed is False
        assert cmp.in_path_gate.executed == cmp.expected_executed
        assert cmp.blocked_by == "allowlist"


class TestArtifactShape:
    def test_anchor_is_agentdojo(self, cmp: Comparison) -> None:
        assert cmp.anchor == ENFORCE_VS_OBSERVE_ANCHOR == "agentdojo:arxiv:2406.13352"

    def test_report_renders_both_lanes(self, cmp: Comparison) -> None:
        report = render_report(cmp)
        assert "OBSERVABILITY-ONLY" in report
        assert "FERRUMDECK IN-PATH GATE" in report
        assert "ferrumdeck.decision=deny" in report
        assert "EXECUTED=true" in report
        assert "EXECUTED=false" in report

    def test_to_dict_roundtrips_key_fields(self, cmp: Comparison) -> None:
        d = cmp.to_dict()
        assert d["case_id"] == "atk_unauth_01"
        assert d["observe_only"]["executed"] is True
        assert d["observe_only"]["decision"] is None
        assert d["in_path_gate"]["decision"] == "deny"
        assert d["in_path_gate"]["executed"] is False

    def test_unknown_case_raises(self) -> None:
        with pytest.raises(KeyError):
            run_comparison(CORPUS, "does_not_exist")
