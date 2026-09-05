"""Tests for the benign corpus and the false-positive measurement.

The number these produce gates a live enforcement switch
(`crate::coherence_evidence`), so the corpus must be reproducible and the
committed artifacts must not be able to drift from the code that made them.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from fd_evals.coherence import (
    DEFAULT_LOOKAHEAD,
    DEFAULT_MIN_CONFIDENCE,
    GENERIC_ERROR,
    TEST_FAILURE,
    _compute_confidence,
    raw_confidence_span,
)
from fd_evals.coherence_negatives import (
    DATASET_DIR,
    MAX_CI_WIDTH_FOR_RATE,
    SHAPE_MIX,
    SWEEP_THRESHOLDS,
    TARGET_TRACES,
    VOCAB_PATH,
    build_corpus,
    build_data_report,
    confidence_floor,
    manifest,
    measure,
    sweep,
)

REPO_ROOT = Path(__file__).resolve().parents[4]

ALLOWED_PROVENANCE = {"real", "synthetic_grounded", "synthetic_authored"}


def test_the_corpus_meets_the_size_floor() -> None:
    traces, _ = build_corpus()
    assert len(traces) >= 200, (
        f"{len(traces)} traces is below the 200 floor; a Wilson interval on a small rate "
        "gets too wide below that to support a threshold decision"
    )


def test_the_corpus_is_deterministic() -> None:
    """Same seed, identical bytes. A rate nobody else can reproduce is not a measurement."""
    a, _ = build_corpus()
    b, _ = build_corpus()
    assert [t.events for t in a] == [t.events for t in b]
    assert [t.id for t in a] == [t.id for t in b]


def test_every_trace_carries_an_auditable_benign_justification() -> None:
    """`why_benign` IS the ground-truth label.

    The false-positive rate is only meaningful if a reader can check the
    labelling rather than take it on trust, so an unjustified trace is a defect.
    """
    traces, _ = build_corpus()
    for t in traces:
        assert t.why_benign.strip(), f"{t.id} has no benign justification"
        assert len(t.why_benign) > 30, f"{t.id}'s justification is too thin to audit"
        assert t.provenance in ALLOWED_PROVENANCE, f"{t.id} has provenance {t.provenance!r}"
        assert t.events, f"{t.id} has no events"


def test_every_declared_shape_is_actually_generated() -> None:
    """A shape in the mix that produces nothing is a declaration, not a case."""
    traces, _ = build_corpus()
    produced = {t.shape for t in traces}
    missing = set(SHAPE_MIX) - produced
    assert not missing, f"declared but never generated: {sorted(missing)}"


def test_the_corpus_is_not_all_one_shape() -> None:
    traces, _ = build_corpus()
    counts: dict[str, int] = {}
    for t in traces:
        counts[t.shape] = counts.get(t.shape, 0) + 1
    assert max(counts.values()) < len(traces) * 0.5, f"one shape dominates the corpus: {counts}"


def test_the_manifest_never_claims_a_real_trace_it_does_not_have() -> None:
    """The one field that must not drift into optimism.

    No committed artifact in this repository carries agent trajectory text, so
    the real count is 0. If that ever becomes non-zero it must be because real
    traces were actually added, not because the label loosened.
    """
    traces, v = build_corpus()
    man = manifest(traces, v, measure(traces))
    real = man["provenance_counts"]["real"]
    actual_real = sum(1 for t in traces if t.provenance == "real")
    assert real == actual_real
    assert "real" in man["provenance_meaning"]


def test_the_measurement_reports_provenance_separately() -> None:
    """Real and synthetic must never be pooled into one unlabelled number."""
    traces, _ = build_corpus()
    r = measure(traces)
    assert r.by_provenance
    assert sum(b["total"] for b in r.by_provenance.values()) == r.total


def test_the_measurement_uses_the_shipped_detector_settings() -> None:
    """A rate obtained by quietly raising min_confidence describes a detector
    nobody is running."""
    from fd_evals.coherence import DEFAULT_LOOKAHEAD, DEFAULT_MIN_CONFIDENCE

    r = measure(build_corpus()[0])
    assert r.lookahead == DEFAULT_LOOKAHEAD
    assert r.min_confidence == DEFAULT_MIN_CONFIDENCE


def test_the_rate_is_not_degenerate() -> None:
    """Zero flagged would mean the corpus was built to avoid the detector.

    A corpus of only cases the matcher handles reports 0% by construction, which
    is the same non-measurement as never running it. This does not assert the
    rate is *good* -- only that the corpus is capable of producing a non-zero
    one.
    """
    r = measure(build_corpus()[0])
    assert r.flagged > 0, (
        "no benign trace flags at all — the corpus is avoiding the detector rather than testing it"
    )
    assert r.flagged < r.total, "every benign trace flags — the corpus or the label is wrong"


def _committed(name: str):
    p = DATASET_DIR / name
    if not p.exists():
        pytest.skip(f"{p} not committed yet")
    return p


def test_the_committed_dataset_matches_the_generator() -> None:
    """The committed corpus must be exactly what the code produces.

    Same guarantee `gen_eval_health.py --check` gives the page: an artifact that
    can drift from its generator is one nobody can re-derive.
    """
    path = _committed("traces.jsonl")
    committed = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    traces, _ = build_corpus()
    assert len(committed) == len(traces)
    for row, t in zip(committed, traces, strict=True):
        assert row["id"] == t.id
        assert row["events"] == t.events, f"{t.id} drifted from the generator"


def test_the_committed_report_matches_a_fresh_measurement() -> None:
    """The published rate must be the rate this code produces today."""
    reports = sorted((REPO_ROOT / "evals/reports").glob("coherence_fp-*.json"))
    if not reports:
        pytest.skip("no coherence_fp report committed yet")
    published = json.loads(reports[-1].read_text())["false_positive_rate"]
    fresh = measure(build_corpus()[0])
    assert published["successes"] == fresh.flagged
    assert published["total"] == fresh.total
    assert abs(published["rate"] - fresh.rate) < 1e-9
    assert abs(published["ci95_high"] - fresh.ci_high) < 1e-9


def test_the_corpus_size_matches_the_target() -> None:
    traces, _ = build_corpus()
    assert len(traces) == TARGET_TRACES


def test_the_report_carries_no_timestamp_so_it_stays_byte_stable() -> None:
    """`asb` and `injection_defense` carry no timestamp either, and that is the
    whole reason they are byte-identical between a local run and a CI run.

    This is pinned because the first draft of the report DID carry a
    `measured_at`, which made every CI run produce a diff and made the
    ".gitignore un-ignore is safe, these are deterministic" claim false. The
    measurement date lives in the filename, which is where
    `gen_eval_health._parse_when` reads it from.
    """
    reports = sorted((REPO_ROOT / "evals/reports").glob("coherence_fp-*.json"))
    if not reports:
        pytest.skip("no coherence_fp report committed yet")
    published = json.loads(reports[-1].read_text())
    for key in published:
        assert "time" not in key.lower(), f"report carries a time-varying key: {key}"
        assert key != "measured_at", "the report must not carry a timestamp"


def test_the_report_uses_the_repos_wilson_key_names() -> None:
    """One reporting format, not two.

    `ProportionCI.to_dict()` is what asb and injection_defense already write.
    A near-identical second key set is how a format quietly forks.
    """
    reports = sorted((REPO_ROOT / "evals/reports").glob("coherence_fp-*.json"))
    if not reports:
        pytest.skip("no coherence_fp report committed yet")
    fp = json.loads(reports[-1].read_text())["false_positive_rate"]
    for key in ("successes", "total", "rate", "ci95_low", "ci95_high"):
        assert key in fp, f"missing the canonical Wilson key {key!r}"


def test_a_measurement_never_reads_git(monkeypatch: pytest.MonkeyPatch) -> None:
    """The corpus must not depend on the history of whoever runs the eval.

    This is a regression test for a defect CI caught and a laptop could not:
    the first version harvested commit subjects with a live `git log`, and a
    pull-request checkout is a synthetic merge commit ("Merge <head> into
    <base>"). That string entered the vocabulary, and the measured rate moved
    from 10.42% (25/240) locally to 12.08% (29/240) on the runner. Both numbers
    were produced by the same code on the same corpus definition, which is what
    makes it a defect rather than noise.

    Blowing up on any subprocess call is a blunt instrument on purpose: it fails
    if anyone reintroduces a shell-out anywhere on the measurement path, not
    just in the harvester it happened in the first time.
    """

    def explode(*args: object, **kwargs: object) -> None:
        msg = "a measurement must not shell out; the vocabulary is frozen on disk"
        raise AssertionError(msg)

    monkeypatch.setattr("fd_evals.coherence_negatives.subprocess.run", explode)
    traces, _ = build_corpus()
    assert len(traces) == TARGET_TRACES


def test_the_frozen_vocabulary_is_committed_and_stamped() -> None:
    """Freezing is only honest if you can see what it was frozen from."""
    assert VOCAB_PATH.exists(), "the corpus cannot be re-derived without its vocabulary"
    data = json.loads(VOCAB_PATH.read_text())
    assert len(data["harvested_at_commit"]) == 40, "the harvest must name the commit it read"
    assert data["harvested_from"], "the harvest must name its sources"
    assert data["commit_subjects"], "an empty vocabulary would silently degrade the corpus"
    assert not [s for s in data["commit_subjects"] if s.startswith("Merge ")], (
        "a merge-commit subject in the vocabulary means the harvest ran on a "
        "pull-request checkout; re-harvest on a real branch"
    )


# -----------------------------------------------------------------------------
# The published data report (docs/reports/)
# -----------------------------------------------------------------------------


def test_the_committed_data_report_is_not_stale() -> None:
    """`docs/reports/coherence-fp-*.md` must match what the generator renders.

    The page carries numbers that are quoted elsewhere. Letting it drift from
    the corpus turns a published measurement into a stale assertion -- the same
    failure `eval-health-check` exists to prevent.
    """
    traces, v = build_corpus()
    path, body = build_data_report(traces, manifest(traces, v, measure(traces)))
    assert path.exists(), f"{path} is missing; run `make docs-coherence-fp`"
    assert path.read_text() == body, (
        f"{path.name} is stale. Run `make docs-coherence-fp` and commit the result."
    )


def test_the_data_report_withholds_a_rate_it_cannot_support() -> None:
    """A class whose interval is too wide prints its count and no percentage.

    `abandoned_no_closure` is n=7: one flag moves the rate 14 points. Printing
    "14.29%" there would be a precision the sample does not carry.
    """
    traces, v = build_corpus()
    _, body = build_data_report(traces, manifest(traces, v, measure(traces)))
    result = measure(traces)

    suppressed = [
        k
        for k, b in result.by_shape.items()
        if b["ci95_high"] - b["ci95_low"] > MAX_CI_WIDTH_FOR_RATE
    ]
    assert suppressed, "expected at least one class too small to carry a rate"
    for k in suppressed:
        row = next(ln for ln in body.splitlines() if ln.startswith(f"| `{k}` |"))
        assert "n too small" in row, f"{k} printed a rate its interval cannot support: {row}"
        assert "%" not in row.split("|")[4], f"{k} printed a percentage: {row}"


def test_the_data_report_prints_the_zero_real_row_rather_than_omitting_it() -> None:
    """`real` is 0. A missing row reads as an oversight; a printed zero is a fact."""
    traces, v = build_corpus()
    _, body = build_data_report(traces, manifest(traces, v, measure(traces)))
    assert "| `real` | 0 | 0 |" in body


def test_the_sweep_starts_at_the_shipped_threshold_and_climbs() -> None:
    """The shipped value is the bottom of the scale, so the ladder runs up from it.

    Before 0.8.18 this asserted two rows either side of a shipped 0.5. That
    shape only made sense while the shipped value sat mid-scale; it now sits at
    the floor, and every row above it must actually be above it.
    """
    assert DEFAULT_MIN_CONFIDENCE in SWEEP_THRESHOLDS
    above = [t for t in SWEEP_THRESHOLDS if t > DEFAULT_MIN_CONFIDENCE]
    assert len(above) >= 3, f"want at least three thresholds above the shipped value, got {above}"

    traces, _ = build_corpus()
    rows = sweep(traces, SWEEP_THRESHOLDS)
    assert [r["min_confidence"] for r in rows] == list(SWEEP_THRESHOLDS)
    assert sum(1 for r in rows if r["shipped"]) == 1


def test_the_shipped_min_confidence_is_live() -> None:
    """The knob must be capable of gating at the scale the config advertises.

    Inverted at 0.8.18. This previously asserted the opposite -- that the
    shipped `min_confidence` sat below the confidence floor and therefore
    changed nothing -- which pinned the defect in place: a passing test suite
    and a threshold no operator could use.

    "Live" means two things, and both are asserted: the shipped default is not
    stranded below the floor, and moving the threshold up the scale actually
    removes spans.
    """
    floor = confidence_floor(DEFAULT_LOOKAHEAD)
    assert DEFAULT_MIN_CONFIDENCE >= floor, (
        f"min_confidence {DEFAULT_MIN_CONFIDENCE} is stranded below the confidence "
        f"floor {floor:.4f} and can never gate anything. Either the scale is "
        "compressed again or the default was lowered past it."
    )

    traces, _ = build_corpus()
    at_default = measure(traces, min_confidence=DEFAULT_MIN_CONFIDENCE)
    raised = measure(traces, min_confidence=0.5)
    assert raised.flagged < at_default.flagged, (
        f"raising min_confidence to 0.5 suppressed nothing "
        f"({raised.flagged} vs {at_default.flagged} flagged) -- the knob is inert again"
    )


def test_the_raw_heuristic_is_compressed_and_must_stay_rescaled() -> None:
    """The regression guard behind `test_the_shipped_min_confidence_is_live`.

    Keeps the pre-0.8.18 finding, which documents something real: the raw
    heuristic `0.6 + proximity + category_bonus` cannot emit below 0.6375 at
    lookahead 8, so it occupies only the top ~36% of its nominal range. That
    compression is exactly what made a `[0, 1]` threshold inert, and it is
    still there in the raw weights -- what changed is that the result is now
    rescaled before anyone can threshold against it.

    If someone deletes the rescale, this fails alongside the liveness test and
    names the cause rather than just the symptom.
    """
    lowest, highest = raw_confidence_span(DEFAULT_LOOKAHEAD)
    assert lowest == pytest.approx(0.6375), f"raw floor moved: {lowest}"
    assert highest == pytest.approx(1.0), f"raw ceiling moved: {highest}"
    assert lowest > 0.5, (
        "the raw heuristic no longer sits above 0.5; the historical reason the "
        "shipped default was inert has changed and the report needs rewriting"
    )

    # ...and the rescale maps that compressed span onto the full unit interval.
    assert _compute_confidence(
        GENERIC_ERROR, DEFAULT_LOOKAHEAD, DEFAULT_LOOKAHEAD
    ) == pytest.approx(0.0)
    assert _compute_confidence(TEST_FAILURE, 1, DEFAULT_LOOKAHEAD) == pytest.approx(1.0)
