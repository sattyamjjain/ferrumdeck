#!/usr/bin/env bash
# Reproducible enforcement decision-path latency benchmark.
#
# Runs the criterion microbenchmark that measures the added CPU cost of the
# governance decision (deny-by-default allowlist, Airlock RASP, the R1-R3
# reversibility ladder, and the EU AI Act Art.50 transparency rule). This is the
# decision path ONLY — it excludes the DB, the Redis queue, and the LLM call.
#
# Deterministic + offline: no services need to be running.
#
# Usage: ./scripts/bench-enforcement.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}/rust"

echo "==> Running enforcement decision-path benchmark (criterion, save-baseline 'current')..."
cargo bench -p fd-policy --bench enforcement_latency -- --save-baseline current

REPORT="${REPO_ROOT}/target/criterion/report/index.html"
echo ""
echo "==> Done. Criterion HTML report:"
echo "    ${REPORT}"
echo "    (open with: open '${REPORT}')"
