"""Reversibility-aware graduated response - Python mirror of the Rust contract.

Mirrors ``fd_policy::reversibility`` (the DeepMind *AI Control Roadmap* R1-R3
ladder) so fd-evals can assert the governance contract deterministically,
without a live gateway - the same pattern the promotion gate uses
(``fd_evals`` mirrors ``fd_policy::promotion``).

The ladder maps a tool's *reversibility* (orthogonal to risk) onto a response:

- ``reversible``   -> ``allow_and_log``      (R1: monitor, no gate)
- ``costly``       -> ``allow_under_budget`` while budget has headroom, else
                       ``require_approval``  (R2 -> R3 on budget exhaustion)
- ``irreversible`` -> ``require_approval``   (R3: human-in-the-loop gate)

Deny-by-default: an unknown / unclassified tool is treated as ``irreversible``.
"""

from __future__ import annotations

# Stable anchor, mirrored on the Rust side.
RESPONSE_LADDER_ANCHOR = "deepmind-ai-control-roadmap-r1-r3"

# Reversibility tiers.
REVERSIBLE = "reversible"
COSTLY = "costly"
IRREVERSIBLE = "irreversible"

# Graduated response levels (R1/R2/R3).
ALLOW_AND_LOG = "allow_and_log"
ALLOW_UNDER_BUDGET = "allow_under_budget"
REQUIRE_APPROVAL = "require_approval"

# Policy-decision kinds (the subset the ladder can produce).
DECISION_ALLOW = "allow"
DECISION_REQUIRES_APPROVAL = "requires_approval"


def parse_reversibility(value: str | None) -> str:
    """Normalize a reversibility string; unknown/None -> ``irreversible``."""
    if value is None:
        return IRREVERSIBLE
    normalized = value.strip().lower()
    if normalized in (REVERSIBLE, COSTLY, IRREVERSIBLE):
        return normalized
    return IRREVERSIBLE


def graduated_response(reversibility: str, budget_has_headroom: bool) -> str:
    """Map (reversibility, budget headroom) -> the R1-R3 response level."""
    rev = parse_reversibility(reversibility)
    if rev == REVERSIBLE:
        return ALLOW_AND_LOG
    if rev == COSTLY:
        return ALLOW_UNDER_BUDGET if budget_has_headroom else REQUIRE_APPROVAL
    # irreversible
    return REQUIRE_APPROVAL


def to_decision(response_level: str) -> str:
    """Map a response level onto the policy-decision kind it implies.

    R1/R2 allow; R3 requires approval (the budget gating that distinguishes R2
    from R3 is applied in :func:`graduated_response`).
    """
    if response_level == REQUIRE_APPROVAL:
        return DECISION_REQUIRES_APPROVAL
    return DECISION_ALLOW


def rung(response_level: str) -> str:
    """The R-rung label (R1/R2/R3) for a response level."""
    return {
        ALLOW_AND_LOG: "R1",
        ALLOW_UNDER_BUDGET: "R2",
        REQUIRE_APPROVAL: "R3",
    }.get(response_level, "R3")
