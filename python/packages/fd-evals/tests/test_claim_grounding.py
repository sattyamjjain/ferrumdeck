"""Tests for the claim-grounding-rate reliability metric (VeriGraph 2606.16603).

Mirrors the Rust ``fd_otel::claim_grounding`` unit tests, and the golden fixture
pins cross-plane agreement with the Rust golden test.
"""

from __future__ import annotations

import json
from pathlib import Path

from fd_evals.claim_grounding import (
    ClaimGrounding,
    compute,
    compute_from_run,
    compute_from_texts,
)

FIXTURES = Path(__file__).parent / "fixtures"


class TestComputeFromTexts:
    def test_empty_output_has_no_claims_and_never_flags(self) -> None:
        m = compute_from_texts("", [], threshold=0.7)
        assert m.claims_total == 0
        assert m.rate == 1.0
        assert m.is_empty
        assert not m.below_threshold

    def test_fully_grounded_output_rate_is_one(self) -> None:
        m = compute_from_texts(
            "The capital of France is Paris.",
            ["Paris is the capital of France."],
            threshold=0.7,
        )
        assert m.claims_total == 1
        assert m.claims_grounded == 1
        assert m.rate == 1.0
        assert not m.below_threshold

    def test_unsupported_claim_is_not_grounded(self) -> None:
        m = compute_from_texts(
            "Bananas are purple and fly to the distant moon.",
            ["Paris is the capital of France."],
            threshold=0.7,
        )
        assert m.claims_total == 1
        assert m.claims_grounded == 0
        assert m.rate == 0.0
        assert m.below_threshold

    def test_trivial_fragments_are_dropped(self) -> None:
        m = compute_from_texts("Done. OK!", [], threshold=0.7)
        assert m.claims_total == 0


class TestComputeCounters:
    def test_threshold_uses_strict_less_than(self) -> None:
        m = compute(10, 7, 0.70)
        assert abs(m.rate - 0.70) < 1e-9
        assert not m.below_threshold

    def test_grounded_clamped_to_total(self) -> None:
        m = compute(3, 9, 0.7)
        assert m.claims_grounded == 3
        assert m.rate == 1.0


class TestComputeFromRun:
    def test_sources_are_tool_step_outputs_only(self) -> None:
        steps = [
            {"step_type": "llm", "output": "irrelevant reasoning about paris"},
            {"step_type": "tool", "output": "Paris is the capital of France."},
        ]
        m = compute_from_run("The capital of France is Paris.", steps, threshold=0.7)
        assert m.claims_total == 1
        assert m.claims_grounded == 1

    def test_structured_output_is_stringified(self) -> None:
        steps = [{"step_type": "tool", "output": {"fact": "Paris capital France"}}]
        m = compute_from_run({"answer": "The capital of France is Paris"}, steps, threshold=0.7)
        assert m.claims_total == 1
        assert m.claims_grounded == 1


class TestGoldenParity:
    def test_matches_cross_plane_golden(self) -> None:
        data = json.loads((FIXTURES / "claim_grounding.golden.json").read_text())
        m = compute_from_texts(data["output"], data["sources"], threshold=data["threshold"])
        exp = data["expected"]
        assert m.claims_total == exp["claims_total"]
        assert m.claims_grounded == exp["claims_grounded"]
        assert abs(m.rate - exp["rate"]) < 1e-12
        assert m.below_threshold == exp["below_threshold"]

    def test_to_dict_round_trips(self) -> None:
        m = ClaimGrounding(3, 2, 2 / 3, True, 0.7)
        d = m.to_dict()
        assert set(d) == {
            "claims_total",
            "claims_grounded",
            "rate",
            "below_threshold",
            "threshold",
        }
