#!/usr/bin/env bash
# Runnable x402 spend-gate demo — governed vs ungoverned autonomous payments.
#
# Simulates an agent working a paywalled x402 endpoint (HTTP 402 Payment
# Required) and shows FerrumDeck's spend gate hard-stopping the run before an
# over-budget stablecoin payment is authorized. It moves no money: it parses
# simulated 402 challenge bodies, prices them in cents, and gates them.
#
# Self-verifying: exits non-zero if the gate ever fails to block the
# over-budget payment.
set -euo pipefail

# Resolve the repo root from this script's location so it runs from anywhere.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

exec cargo run --quiet -p ferrumdeck --example x402_spend_gate "$@"
