"""Claim-grounding-rate reliability metric — per VeriGraph (arXiv:2606.16603).

``claim_grounding_rate = (claims reachable from a source node) / (total claims)``

For a completed run, a *claim* is a sentence in the final agent output and a
*source node* is a tool-step output (raw data the agent observed). Per
VeriGraph's claim-level definition, a claim is **grounded** when a reachable
evidence path exists from some source node to that claim.

This module mirrors the Rust ``fd_otel::claim_grounding`` shape **and
algorithm** token-for-token, so the same run scores identically on either
plane (a shared golden fixture pins the agreement).

Honest scope: "reachable evidence path" is operationalized as a
**deterministic lexical-overlap reachability proxy** — pure, CI-stable, no LLM
judge — in the same spirit as ``fd_evals.firing_rate``. It is *grounding rate
per VeriGraph*, a lineage to the claim-level auditability literature, **not** a
ferrumdeck-original metric and **not** a semantic-entailment judgment. It is a
reliability *signal*: an optional project threshold only *flags* a run, never
blocks a tool or kills a run.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from fd_runtime.tracing import FD_RELIABILITY_CLAIM_GROUNDING_DEFAULT_THRESHOLD

# Pinned constants — keep in sync with the Rust `fd_otel::claim_grounding`.
DEFAULT_MIN_CLAIM_GROUNDING_RATE = FD_RELIABILITY_CLAIM_GROUNDING_DEFAULT_THRESHOLD
MIN_CLAIM_TOKENS = 3
GROUNDING_OVERLAP = 0.5
_MIN_TOKEN_LEN = 3

_CLAIM_SPLIT = re.compile(r"[.!?\n]")
_TOKEN_SPLIT = re.compile(r"[^A-Za-z0-9]+")
_STEP_TYPE_TOOL = "tool"


@dataclass(frozen=True)
class ClaimGrounding:
    """Per-run claim-grounding snapshot.

    Same field shape as the Rust ``fd_otel::claim_grounding::ClaimGrounding``
    struct so the JSON wire contract is one shape, not two.
    """

    claims_total: int
    claims_grounded: int
    rate: float
    below_threshold: bool
    threshold: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "claims_total": self.claims_total,
            "claims_grounded": self.claims_grounded,
            "rate": self.rate,
            "below_threshold": self.below_threshold,
            "threshold": self.threshold,
        }

    @property
    def is_empty(self) -> bool:
        return self.claims_total == 0


def compute(
    claims_total: int,
    claims_grounded: int,
    threshold: float = DEFAULT_MIN_CLAIM_GROUNDING_RATE,
) -> ClaimGrounding:
    """Pure compute. Mirrors Rust ``ClaimGrounding::compute``.

    ``claims_grounded`` is clamped to ``claims_total``. A run with no claims
    returns ``rate == 1.0`` and ``below_threshold == False`` — nothing to
    ground means nothing ungrounded, so "no claims" never flags.
    """
    if claims_total < 0 or claims_grounded < 0:
        raise ValueError("claim counters must be non-negative")
    claims_grounded = min(claims_grounded, claims_total)
    rate = (claims_grounded / claims_total) if claims_total > 0 else 1.0
    below = claims_total > 0 and rate < threshold
    return ClaimGrounding(
        claims_total=claims_total,
        claims_grounded=claims_grounded,
        rate=rate,
        below_threshold=below,
        threshold=threshold,
    )


def compute_from_texts(
    output: str,
    sources: Iterable[str],
    threshold: float = DEFAULT_MIN_CLAIM_GROUNDING_RATE,
) -> ClaimGrounding:
    """Derive the metric from the final ``output`` text and ``sources``
    (tool-output strings). Deterministic; mirrors the Rust
    ``compute_from_texts`` rule exactly."""
    source_tokens: set[str] = set()
    for src in sources:
        source_tokens.update(_significant_tokens(src))

    total = 0
    grounded = 0
    for claim in _split_claims(output):
        toks = set(_significant_tokens(claim))
        if len(toks) < MIN_CLAIM_TOKENS:
            continue
        total += 1
        covered = sum(1 for t in toks if t in source_tokens)
        if covered / len(toks) >= GROUNDING_OVERLAP:
            grounded += 1
    return compute(total, grounded, threshold)


def compute_from_run(
    output: Any,
    steps: Iterable[dict[str, Any]],
    threshold: float = DEFAULT_MIN_CLAIM_GROUNDING_RATE,
) -> ClaimGrounding:
    """Derive the metric from a run's final ``output`` and its ``steps``.

    Source nodes are the outputs of ``step_type == "tool"`` steps (raw data the
    agent observed). ``output`` and tool outputs may be strings or structured
    JSON — both are stringified before tokenizing (tokenization strips all
    punctuation, so the token set is identical regardless of JSON formatting,
    which is what keeps the two planes in agreement on structured output).
    """
    output_text = _stringify(output)
    sources: list[str] = []
    for step in steps:
        # Defensive: callers may hand a malformed / non-list `steps` (e.g. a
        # mock run context). Skip anything that isn't a step dict rather than
        # raise — this is a best-effort reliability signal, never fatal.
        if not isinstance(step, dict):
            continue
        if step.get("step_type") == _STEP_TYPE_TOOL:
            out = step.get("output")
            if out is not None:
                sources.append(_stringify(out))
    return compute_from_texts(output_text, sources, threshold)


def record_on_span(span: Any, metric: ClaimGrounding) -> None:
    """Tag an OTel span with the claim-grounding attributes (mirror of the
    Rust ``record_on_span``)."""
    from fd_runtime.tracing import (
        FD_RELIABILITY_CLAIM_GROUNDING_FLAGGED,
        FD_RELIABILITY_CLAIM_GROUNDING_RATE,
        FD_RELIABILITY_CLAIM_GROUNDING_THRESHOLD,
    )

    span.set_attribute(FD_RELIABILITY_CLAIM_GROUNDING_RATE, metric.rate)
    span.set_attribute(FD_RELIABILITY_CLAIM_GROUNDING_FLAGGED, metric.below_threshold)
    span.set_attribute(FD_RELIABILITY_CLAIM_GROUNDING_THRESHOLD, metric.threshold)


def _split_claims(text: str) -> list[str]:
    return [c.strip() for c in _CLAIM_SPLIT.split(text) if c.strip()]


def _significant_tokens(text: str) -> list[str]:
    return [t.lower() for t in _TOKEN_SPLIT.split(text) if len(t) >= _MIN_TOKEN_LEN]


def _stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return json.dumps(value, sort_keys=True, ensure_ascii=False)


__all__ = [
    "ClaimGrounding",
    "DEFAULT_MIN_CLAIM_GROUNDING_RATE",
    "GROUNDING_OVERLAP",
    "MIN_CLAIM_TOKENS",
    "compute",
    "compute_from_run",
    "compute_from_texts",
    "record_on_span",
]
