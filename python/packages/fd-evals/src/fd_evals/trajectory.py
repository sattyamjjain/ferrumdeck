"""Persist the agent text an eval run already parsed, instead of discarding it.

## Why this exists

``docs/reports/coherence-fp-*.md`` publishes the coherence monitor's
false-positive rate split by provenance, and the ``real`` arm -- trajectories
captured verbatim from a real agent run -- has always been **n=0**. The stated
reason was that no committed artifact carries agent trajectory text.

That was true, and it was not because real runs were unavailable. The harness
already parses the text: :func:`fd_evals.claim_grounding.compute_from_run`
receives the run's final ``output`` and its tool-step outputs, splits the output
into claims, counts them, and returns the count. A committed report carries
``"claims_total": 17`` next to ``"output_tokens": 237`` -- proof that seventeen
statements were extracted and then dropped on the floor. The corpus was empty
because the *writer* discarded the field, not because the data did not exist.

This module keeps it, in the exact event shape
:meth:`fd_evals.coherence_negatives.BenignTrace.to_events` consumes.

## Opt-in, deliberately

Persisting model output is a **data-handling change, not a bug fix**. What lands
on disk is raw agent text -- whatever the model said, unredacted -- so an eval
harness must not start recording it because a dependency bumped. It is off
unless the operator says otherwise, by either:

* ``--persist-trajectory`` on ``fd-eval run``, or
* ``FD_EVALS_PERSIST_TRAJECTORY=1`` in the environment.

## What gets written

A ``trajectory`` key on each element of ``results`` in
``evals/reports/eval_*.json``, absent entirely when the flag is off:

* one ``{"kind": "statement", "text": ...}`` per claim in the agent's final
  output, using the **same** split-and-filter rule that produces
  ``claims_total`` (``MIN_CLAIM_TOKENS`` significant tokens), so the two
  views of a run cannot drift into different notions of "a claim". The
  counts are close but need not be identical: this unwraps the agent's prose
  from its JSON envelope first, where ``claims_total`` measures the
  stringified whole;
* one ``{"kind": "action", "name": <tool>, "text": ...}`` per tool step, in run
  order.

Every ``text`` is clipped to :data:`MAX_TEXT_CHARS`, matching the clip the
coherence monitor applies to a quoted fact, so a persisted trajectory cannot be
larger than what the detector would ever quote back.
"""

from __future__ import annotations

import os
from typing import Any

from fd_evals.claim_grounding import (
    MIN_CLAIM_TOKENS,
    _significant_tokens,
    _split_claims,
    _stringify,
)
from fd_evals.coherence import MAX_QUOTE_CHARS

#: Environment opt-in. Any of ``1/true/yes/on`` (case-insensitive) enables it.
PERSIST_ENV = "FD_EVALS_PERSIST_TRAJECTORY"

#: Per-event text cap. Mirrors the coherence monitor's own quote clip.
MAX_TEXT_CHARS = MAX_QUOTE_CHARS

_TRUTHY = {"1", "true", "yes", "on"}
_STEP_TYPE_TOOL = "TOOL"


def persistence_enabled(explicit: bool | None = None) -> bool:
    """Whether to persist agent text for this run.

    ``explicit`` (the CLI flag) wins when given; otherwise the environment
    decides. Default is **off** -- see the module docstring.
    """
    if explicit is not None:
        return explicit
    return os.environ.get(PERSIST_ENV, "").strip().lower() in _TRUTHY


#: Keys an agentic run wraps its prose in. The control plane returns structured
#: output (``{"iterations": 1, "response": "..."}``), and stringifying that
#: whole envelope persists JSON punctuation as if the agent had said it.
_TEXT_KEYS = ("response", "output", "content", "text", "message", "summary")


def _agent_text(value: Any) -> str:
    """The agent's own prose, unwrapped from whatever envelope carries it."""
    if isinstance(value, dict):
        for key in _TEXT_KEYS:
            inner = value.get(key)
            if isinstance(inner, str) and inner.strip():
                return inner
    return _stringify(value)


def _claims(text: str) -> list[str]:
    """Split into claims using the *same* rule as `claim_grounding`.

    A fragment under ``MIN_CLAIM_TOKENS`` significant tokens is not a claim
    there and is not a statement here, which is what keeps ``claims_total`` and
    the persisted statement count describing the same thing. Without the filter
    the splitter emits punctuation debris -- ``md``, ``(e``, ``g`` out of
    "e.g. README.md" -- as if the agent had asserted it.
    """
    return [c for c in _split_claims(text) if len(_significant_tokens(c)) >= MIN_CLAIM_TOKENS]


def _clip(text: str) -> str:
    trimmed = text.strip()
    if len(trimmed) <= MAX_TEXT_CHARS:
        return trimmed
    return trimmed[:MAX_TEXT_CHARS] + "…"


def extract_trajectory(output: Any, steps: Any) -> list[dict[str, str]]:
    """Project a run onto the coherence trajectory event shape.

    Mirrors the traversal in :func:`fd_evals.claim_grounding.compute_from_run`
    -- tool steps are the actions, the final output carries the statements --
    so the two derived views of a run cannot drift apart.

    Best-effort and never fatal: a malformed ``steps`` (a mock context, a
    non-list) yields whatever could be read rather than raising. An eval must
    not fail because a side-channel recording failed.
    """
    events: list[dict[str, str]] = []
    last_prose = ""

    if isinstance(steps, list):
        for step in steps:
            if not isinstance(step, dict):
                continue
            step_type = str(step.get("step_type") or step.get("type") or "").upper()
            tool_name = step.get("tool_name") or step.get("name")
            if step_type == _STEP_TYPE_TOOL or tool_name:
                # The action's text is what the agent did, preferring the call
                # arguments over the result: the monitor asks whether an action
                # advanced past a stated blocker, which is a property of the
                # request, not of what came back.
                detail = step.get("input")
                if detail is None:
                    detail = step.get("output")
                events.append(
                    {
                        "kind": "action",
                        "name": str(tool_name or "tool"),
                        "text": _clip(_stringify(detail)),
                    }
                )
                continue
            # A non-tool step (LLM, retrieval): its output is agent prose.
            prose = _agent_text(step.get("output"))
            last_prose = prose or last_prose
            for claim in _claims(prose):
                events.append({"kind": "statement", "text": _clip(claim)})

    # The run's final output is usually the last LLM step's output verbatim.
    # Appending it unconditionally persists every closing statement twice and
    # doubles the apparent length of the trajectory, which would inflate the
    # gap between a stated fact and a later action.
    final = _agent_text(output)
    if final.strip() and final.strip() != last_prose.strip():
        for claim in _claims(final):
            events.append({"kind": "statement", "text": _clip(claim)})

    return events


__all__ = [
    "MAX_TEXT_CHARS",
    "PERSIST_ENV",
    "extract_trajectory",
    "persistence_enabled",
]
