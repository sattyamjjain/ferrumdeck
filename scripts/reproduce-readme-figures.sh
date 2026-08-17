#!/usr/bin/env bash
# Re-verify every numbered claim in README.md from a clean clone.
#
# `make reproduce-spend-gate` already did this for the two spend figures and
# exits non-zero on drift. It was the only figure in the repo with that
# property. The latency table, the attack/benign block rates and their Wilson
# intervals were all typed in by hand from a run nobody could re-run on demand
# -- and one of them, `make bench-enforcement`, had been failing outright since
# the policy crate was renamed for crates.io, so the command README points at
# for reproducing the latency numbers exited 101 for anyone who tried.
#
# What this drives:
#   1. the criterion enforcement-latency benchmark  -> p50/p95 per layer
#   2. injection-defense, ASB and governed-benchmark -> block/benign rates
#   3. scripts/check_readme_figures.py               -> compares against the docs
#
# Everything is deterministic and offline. No services, no API keys, no money.
# Reports are written to a temp directory so the working tree is untouched.
#
# Usage:
#   scripts/reproduce-readme-figures.sh              (or: make reproduce-readme-figures)
#   scripts/reproduce-readme-figures.sh --skip-latency   # rates only, ~20s
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31mFAIL:\033[0m %s\n' "$*" >&2; exit 1; }

SKIP_LATENCY=0
for arg in "$@"; do
  case "$arg" in
    --skip-latency) SKIP_LATENCY=1 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) fail "unknown argument: $arg" ;;
  esac
done

missing=""
command -v cargo >/dev/null 2>&1 || missing="$missing cargo(rustup: https://rustup.rs)"
command -v uv    >/dev/null 2>&1 || missing="$missing uv(https://docs.astral.sh/uv/)"
[ -n "$missing" ] && fail "missing prerequisites:$missing"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
STAMP="$(date +%Y%m%d)"

# ---------------------------------------------------------------------------
# 1. Latency. Slow (~2 min: six cases, 100 samples each after a 3s warm-up),
#    so it is skippable for a rates-only check.
# ---------------------------------------------------------------------------
if [ "$SKIP_LATENCY" -eq 1 ]; then
  bold "[1/3] Enforcement latency — SKIPPED (--skip-latency)"
else
  bold "[1/3] Enforcement latency (criterion, offline)"
  ./scripts/bench-enforcement.sh >"$TMP/bench.log" 2>&1 \
    || { tail -20 "$TMP/bench.log" >&2; fail "the enforcement benchmark did not complete."; }
  echo "  OK  six cases measured, 100 samples each."
fi

# ---------------------------------------------------------------------------
# 2. Rate benchmarks. Deterministic, seeded, no LLM. Written into $TMP so a
#    reproduce run never leaves untracked reports in evals/reports/ -- those
#    are published evidence and should only ever arrive deliberately.
# ---------------------------------------------------------------------------
bold "[2/3] Governance rate benchmarks (deterministic, offline, no LLM)"

uv run python -m fd_evals injection-defense --suite injection_defense \
  --output "$TMP/injection_defense-${STAMP}.json" >"$TMP/inj.log" 2>&1 \
  || { tail -20 "$TMP/inj.log" >&2; fail "injection-defense benchmark failed."; }
echo "  OK  injection-defense"

uv run python -m fd_evals asb --suite asb --seed 0 \
  --output "$TMP/asb-${STAMP}.json" >"$TMP/asb.log" 2>&1 \
  || { tail -20 "$TMP/asb.log" >&2; fail "ASB benchmark failed."; }
echo "  OK  asb (+ EU AI Act Art.50)"

uv run python -m fd_evals governed-benchmark \
  --output "$TMP/governed-benchmark-${STAMP}.json" >"$TMP/gov.log" 2>&1 \
  || { tail -20 "$TMP/gov.log" >&2; fail "governed benchmark failed."; }
echo "  OK  governed-vs-ungoverned"

# ---------------------------------------------------------------------------
# 3. Compare. Exits non-zero on drift; the comparison regime (exact for rates,
#    banded for latency, band widened off the reference machine) is printed by
#    the checker itself rather than assumed here.
# ---------------------------------------------------------------------------
bold "[3/3] Comparing against the published figures"
CHECK_ARGS=(--reports "$TMP" --criterion "$ROOT/target/criterion" --readme "$ROOT/README.md")
[ "$SKIP_LATENCY" -eq 1 ] && CHECK_ARGS+=(--skip-latency)

if uv run python scripts/check_readme_figures.py "${CHECK_ARGS[@]}"; then
  echo
  bold "Reproduced. Every published figure holds within its stated regime."
else
  echo
  fail "one or more published figures no longer reproduce (see DRIFT rows above)."
fi
