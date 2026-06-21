"""Deterministic reversibility-ladder gate tests (DeepMind R1-R3).

Mirrors the Rust ``fd_policy::reversibility`` contract. CI-gated by
``make test-python``. The three canonical cases the feature must guarantee:

1. a *reversible* action passes WITHOUT a gate (R1 allow-and-log);
2. an *irreversible* action BLOCKS until approval (R3 require-approval);
3. a *costly* action flips to approval when the budget is breached (R2 -> R3).
"""

from __future__ import annotations

from fd_evals.reversibility import (
    ALLOW_AND_LOG,
    ALLOW_UNDER_BUDGET,
    COSTLY,
    DECISION_ALLOW,
    DECISION_REQUIRES_APPROVAL,
    IRREVERSIBLE,
    REQUIRE_APPROVAL,
    REVERSIBLE,
    graduated_response,
    parse_reversibility,
    to_decision,
)


class TestReversiblePassesWithoutGate:
    def test_reversible_is_allow_and_log_regardless_of_budget(self) -> None:
        for headroom in (True, False):
            level = graduated_response(REVERSIBLE, budget_has_headroom=headroom)
            assert level == ALLOW_AND_LOG
            # No gate: the decision is a plain allow.
            assert to_decision(level) == DECISION_ALLOW


class TestIrreversibleBlocksUntilApproval:
    def test_irreversible_requires_approval(self) -> None:
        for headroom in (True, False):
            level = graduated_response(IRREVERSIBLE, budget_has_headroom=headroom)
            assert level == REQUIRE_APPROVAL
            # Blocks until a human approves.
            assert to_decision(level) == DECISION_REQUIRES_APPROVAL


class TestCostlyFlipsOnBudgetBreach:
    def test_costly_allowed_under_budget_with_headroom(self) -> None:
        level = graduated_response(COSTLY, budget_has_headroom=True)
        assert level == ALLOW_UNDER_BUDGET
        assert to_decision(level) == DECISION_ALLOW

    def test_costly_flips_to_approval_when_budget_breached(self) -> None:
        level = graduated_response(COSTLY, budget_has_headroom=False)
        assert level == REQUIRE_APPROVAL
        assert to_decision(level) == DECISION_REQUIRES_APPROVAL


class TestDenyByDefault:
    def test_unknown_reversibility_defaults_to_irreversible(self) -> None:
        assert parse_reversibility(None) == IRREVERSIBLE
        assert parse_reversibility("nonsense") == IRREVERSIBLE
        assert parse_reversibility("") == IRREVERSIBLE
        # ...and therefore gates by default.
        assert graduated_response("nonsense", budget_has_headroom=True) == REQUIRE_APPROVAL

    def test_parse_normalizes_known_tiers(self) -> None:
        assert parse_reversibility("REVERSIBLE") == REVERSIBLE
        assert parse_reversibility("  Costly ") == COSTLY
        assert parse_reversibility("irreversible") == IRREVERSIBLE
