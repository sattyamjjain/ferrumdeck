"""Tests for opt-in agent-text persistence (`fd_evals.trajectory`).

The load-bearing property here is the **default**: this writes raw model output
to disk, so it must stay off until an operator asks. A regression that flips it
on is a data-handling incident, not a failing assertion.
"""

from __future__ import annotations

import pytest

from fd_evals.claim_grounding import compute_from_run
from fd_evals.coherence import TrajectoryEvent
from fd_evals.coherence_negatives import BenignTrace
from fd_evals.trajectory import (
    MAX_TEXT_CHARS,
    PERSIST_ENV,
    extract_trajectory,
    persistence_enabled,
)


def test_persistence_is_off_unless_asked(monkeypatch: pytest.MonkeyPatch) -> None:
    """The default is off. This is the whole safety property of the feature."""
    monkeypatch.delenv(PERSIST_ENV, raising=False)
    assert persistence_enabled() is False
    assert persistence_enabled(None) is False


def test_explicit_false_beats_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """`--no-persist-trajectory` must win over an env var someone left set."""
    monkeypatch.setenv(PERSIST_ENV, "1")
    assert persistence_enabled(True) is True
    assert persistence_enabled(None) is True
    assert persistence_enabled(False) is False


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "yes", "on"])
def test_environment_opt_in_forms(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    monkeypatch.setenv(PERSIST_ENV, value)
    assert persistence_enabled() is True


@pytest.mark.parametrize("value", ["", "0", "false", "no", "off", "maybe"])
def test_environment_non_opt_in_forms(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    monkeypatch.setenv(PERSIST_ENV, value)
    assert persistence_enabled() is False


def test_extraction_produces_the_shape_benigntrace_consumes() -> None:
    """The persisted events must feed `BenignTrace.to_events()` unchanged —
    that is the only reason to persist them in this shape."""
    steps = [
        {"step_type": "LLM", "output": "The tests are still failing on CI."},
        {"step_type": "TOOL", "tool_name": "git_commit", "input": {"message": "done"}},
    ]
    events = extract_trajectory("Marking the task complete anyway.", steps)

    trace = BenignTrace(
        id="t",
        shape="observed",
        provenance="real",
        why_benign="fixture",
        sources=["test"],
        events=events,
    )
    projected = trace.to_events()
    assert all(isinstance(e, TrajectoryEvent) for e in projected)
    assert [e.kind for e in projected] == [e["kind"] for e in events]


def test_tool_steps_become_actions_and_prose_becomes_statements() -> None:
    steps = [
        {"step_type": "LLM", "output": "Permission denied writing to the config file."},
        {"step_type": "TOOL", "tool_name": "git_push", "input": {"branch": "main"}},
    ]
    events = extract_trajectory("", steps)
    kinds = [e["kind"] for e in events]
    assert "statement" in kinds and "action" in kinds
    action = next(e for e in events if e["kind"] == "action")
    assert action["name"] == "git_push"


def test_the_final_output_is_not_persisted_twice() -> None:
    """The run's output is usually the last LLM step verbatim. Appending it
    unconditionally doubled every closing statement and inflated the gap
    between a stated fact and a later action."""
    prose = "The build succeeded. All checks passed."
    steps = [{"step_type": "LLM", "output": prose}]
    events = extract_trajectory(prose, steps)
    texts = [e["text"] for e in events]
    assert len(texts) == len(set(texts)), f"duplicated statements: {texts}"


def test_fragments_below_the_claim_floor_are_not_statements() -> None:
    """Uses the same MIN_CLAIM_TOKENS rule as `claim_grounding`, so punctuation
    debris ('md', '(e', 'g' out of 'e.g. README.md') is not persisted as
    something the agent asserted."""
    events = extract_trajectory("See e.g. README.md for the full contributor guide.", [])
    for e in events:
        assert len(e["text"].split()) >= 2, f"debris persisted as a statement: {e}"


def test_text_is_clipped() -> None:
    events = extract_trajectory("word " * 400, [])
    assert events
    for e in events:
        assert len(e["text"]) <= MAX_TEXT_CHARS + 1  # +1 for the ellipsis


def test_malformed_steps_do_not_raise() -> None:
    """A side-channel recording must never fail the eval it is observing."""
    assert extract_trajectory("out", None) == extract_trajectory("out", [])
    assert extract_trajectory("out", ["not-a-dict", 42]) == extract_trajectory("out", [])


def test_extraction_agrees_with_claim_grounding_on_what_a_claim_is() -> None:
    """Both views of a run must share one notion of 'a claim'. They need not
    produce identical counts (this unwraps the JSON envelope first), but a
    statement here must never be a fragment claim_grounding would discard."""
    output = "The migration applied cleanly. Two indexes were created."
    steps = [{"step_type": "TOOL", "tool_name": "db_migrate", "output": "ok"}]
    events = extract_trajectory(output, steps)
    statements = [e for e in events if e["kind"] == "statement"]
    assert len(statements) == compute_from_run(output, steps).claims_total
