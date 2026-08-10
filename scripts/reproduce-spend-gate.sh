#!/usr/bin/env bash
# Reproduce FerrumDeck's spend-gate figures from a clean clone.
#
# The two most-cited numbers in the repo:
#   - AP2 payment governance: an agent's 4 cart mandates total $150.95 ungoverned;
#     the gate authorizes only the one valid $0.40 cart (3/3 unsafe blocked on a
#     bad Ed25519 signature, an over-ceiling amount, and an out-of-scope merchant).
#   - Spend-overrun: a fixed safe-PR trajectory with 4 injected unsafe actions
#     costs 184.0c ungoverned vs 85.4c governed (4/4 blocked vs 0/4), because
#     stopping the RCE / exfil / denied-tool / runaway-loop saves more than the
#     ~1us/decision + audit overhead.
#
# Everything here is deterministic, offline, and moves no money. It drives the
# real engine (the AP2 gate test + the x402 example) and recomputes the figures
# with the governed-benchmark, then FAILS (non-zero exit) if any number drifts
# outside the tolerance the docs call deterministic.
#
# Usage:  scripts/reproduce-spend-gate.sh          (or: make reproduce-spend-gate)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31mFAIL:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Prerequisites — name exactly what is missing, then stop.
# ---------------------------------------------------------------------------
missing=""
command -v cargo   >/dev/null 2>&1 || missing="$missing cargo(rustup: https://rustup.rs)"
command -v uv      >/dev/null 2>&1 || missing="$missing uv(https://docs.astral.sh/uv/)"
command -v python3 >/dev/null 2>&1 || missing="$missing python3"
if [ -n "$missing" ]; then
  fail "missing prerequisites:$missing"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
GB="$TMP/governed-benchmark.json"

# ---------------------------------------------------------------------------
# 1. AP2 gate scenario, end to end, against the real policy engine.
#    ap2_gate.rs drives evaluate_ap2_payment over the 4-mandate set and asserts
#    the 3 unsafe carts are each denied on a distinct control and the 1 valid
#    cart authorizes.
# ---------------------------------------------------------------------------
bold "[1/3] AP2 gate (real engine, deterministic)"
cargo test --quiet -p ferrumdeck-policy --test ap2_gate >/dev/null 2>&1 \
  || fail "the AP2 gate test did not pass — the payment gate is not blocking as documented."
echo "  OK  AP2 gate: 3/3 unsafe mandates denied, 1 valid authorized."

# ---------------------------------------------------------------------------
# 2. x402 gate scenario. The example is self-verifying: it exits non-zero if the
#    over-budget USDC payment is ever authorized.
# ---------------------------------------------------------------------------
bold "[2/3] x402 spend gate (self-verifying example)"
if cargo run --quiet -p ferrumdeck --example x402_spend_gate >"$TMP/x402.out" 2>&1; then
  echo "  OK  x402 spend gate blocked the over-budget payment."
else
  cat "$TMP/x402.out" >&2
  fail "the x402 spend-gate example failed — the gate did not block the over-budget payment."
fi

# ---------------------------------------------------------------------------
# 3. Recompute the sellable figures with the governed benchmark, then assert.
# ---------------------------------------------------------------------------
bold "[3/3] Governed-vs-ungoverned benchmark (recomputing the figures)"
uv run python -m fd_evals governed-benchmark -o "$GB" >/dev/null 2>&1 \
  || fail "governed-benchmark did not run (uv sync first?)."

python3 - "$GB" <<'PY'
import json, math, sys

d = json.load(open(sys.argv[1]))

def wilson(k, n, z=1.96):
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    margin = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (max(0.0, center - margin), min(1.0, center + margin))

# Documented, deterministic figures. The workload is fixed, so these are exact;
# costs carry a 1-cent epsilon only to absorb float display rounding (85.36 ~ 85.4).
EPS = 1.0
errors = []

def approx(label, got, want, eps=EPS):
    ok = abs(got - want) <= eps
    print(f"  {'OK ' if ok else 'BAD'} {label}: {got} (expected {want} +/- {eps})")
    if not ok:
        errors.append(f"{label}: got {got}, expected {want} +/- {eps}")

def exact(label, got, want):
    ok = got == want
    print(f"  {'OK ' if ok else 'BAD'} {label}: {got} (expected {want})")
    if not ok:
        errors.append(f"{label}: got {got}, expected {want}")

ap2 = d["ap2"]
ung_ap2 = ap2["ungoverned_exec_cost_cents"]
gov_ap2 = ap2["governed_exec_cost_cents"]
ung_run = d["ungoverned"]["total_cost_cents"]
gov_run = d["governed"]["total_cost_cents"]

print()
print("AP2 payment governance (4 cart mandates):")
print(f"    ungoverned pays every cart : ${ung_ap2/100:,.2f}  ({ung_ap2:g}c)")
print(f"    governed pays the valid one: ${gov_ap2/100:,.2f}  ({gov_ap2:g}c)")
lo, hi = wilson(ap2["governed_blocked"], ap2["unsafe_total"])
print(f"    unsafe blocked: {ap2['governed_blocked']}/{ap2['unsafe_total']} "
      f"(Wilson 95% CI [{lo*100:.1f}%, {hi*100:.1f}%])")

print()
print("Spend-overrun (fixed safe-PR trajectory, 4 injected unsafe actions):")
print(f"    ungoverned run cost: {ung_run:g}c")
print(f"    governed run cost  : {gov_run:g}c")
lo, hi = wilson(d["governed_blocked"], d["unsafe_total"])
print(f"    unsafe blocked: {d['governed_blocked']}/{d['unsafe_total']} governed "
      f"vs {d['ungoverned_blocked']}/{d['unsafe_total']} ungoverned "
      f"(governed Wilson 95% CI [{lo*100:.1f}%, {hi*100:.1f}%])")

print()
print("Assertions vs the documented figures:")
exact("AP2 ungoverned spend (cents)", ung_ap2, 15095.0)   # $150.95
exact("AP2 governed spend (cents)",   gov_ap2, 40.0)       # $0.40
approx("spend-overrun ungoverned (cents)", ung_run, 184.0)
approx("spend-overrun governed (cents)",   gov_run, 85.4)
exact("governed block rate (%)",   d["governed_block_pct"], 100.0)
exact("ungoverned block rate (%)", d["ungoverned_block_pct"], 0.0)
exact("AP2 governed block rate (%)", ap2["governed_block_pct"], 100.0)

if errors:
    print()
    for e in errors:
        print(f"  DRIFT: {e}", file=sys.stderr)
    sys.exit(1)
PY

echo
bold "Reproduced. AP2 \$150.95 -> \$0.40 and spend-overrun 184.0c -> 85.4c both hold."
