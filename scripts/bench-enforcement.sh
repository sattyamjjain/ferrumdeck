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
cd "${REPO_ROOT}"

echo "==> Running enforcement decision-path benchmark (criterion, save-baseline 'current')..."
# The crate's package name is `ferrumdeck-policy`; only its lib target is
# `fd_policy`. This said `-p fd-policy`, which stopped matching when the crate
# was renamed for crates.io, so the command README points at for reproducing the
# latency table failed with "package ID specification did not match any
# packages" -- exit 101, every time, for anyone who tried.
cargo bench -p ferrumdeck-policy --bench enforcement_latency -- --save-baseline current

# A benchmark that runs but writes nothing leaves the figures unverifiable while
# looking like it worked, so check the samples landed before claiming success.
if [ ! -d "${REPO_ROOT}/target/criterion" ]; then
  echo "FAIL: no criterion output under target/criterion after a successful run." >&2
  exit 1
fi

REPORT="${REPO_ROOT}/target/criterion/report/index.html"
echo ""
echo "==> Done. Criterion HTML report:"
echo "    ${REPORT}"
echo "    (open with: open '${REPORT}')"
