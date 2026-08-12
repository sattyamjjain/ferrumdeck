#!/usr/bin/env bash
# =============================================================================
# FerrumDeck — one-command reproducible governance demo
# =============================================================================
# Boots the local stack and proves, against the REAL gateway API, the four
# control-plane guarantees a stranger can verify in <5 minutes:
#
#   1. Deny-by-default tool policy   (an un-allowlisted tool is DENIED)
#   2. Approval gate                 (a write tool REQUIRES human approval)
#   3. Immutable audit trail         (every decision is appended, never mutated)
#   4. OTel / GenAI spans            (every enforce decision lands in Jaeger)
#   + a deterministic golden-trace replay (the metric wire-contract regression)
#
# Part A (below) is fully deterministic and needs NO LLM key — it drives the
# policy engine directly via POST /v1/runs/{id}/check-tool.
# Part B (optional, end of file) runs the example agent end-to-end through the
# fd-evals smoke suite; it needs ANTHROPIC_API_KEY and exercises live budget
# auto-kill + the approval queue.
#
# Usage:   ./examples/demo/run-demo.sh
# Cleanup: make dev-down
# =============================================================================
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

GATEWAY="${GATEWAY:-http://localhost:8080}"
KEY="${FD_API_KEY:-fd_dev_key_abc123}"          # seeded dev key (read/write/admin)
AGENT="${FD_AGENT:-agt_01JFVX0000000000000000001}"   # seeded "Safe PR Agent"
# Default: build from source (compose.dev.yaml). Set COMPOSE_FILE to
# deploy/docker/compose.demo.yaml to run against the published GHCR images with no
# Rust/Node toolchain (that is what QUICKSTART.md and the demo CI job use).
COMPOSE_FILE="${COMPOSE_FILE:-deploy/docker/compose.dev.yaml}"
COMPOSE=(docker compose --env-file .env -f "$COMPOSE_FILE")
SUF="$(date +%s)"                                # per-run suffix → re-runnable
PASS=0; FAIL=0

c()   { printf '\033[%sm%s\033[0m' "$1" "$2"; }
hdr() { printf '\n%s\n' "$(c '1;36' "▸ $*")"; }
ok()  { PASS=$((PASS+1)); printf '  %s %s\n' "$(c '1;32' '✓')" "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  %s %s\n' "$(c '1;31' '✗')" "$*"; }
api() { curl -fsS -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" "$@"; }

for bin in docker curl jq; do command -v "$bin" >/dev/null || { echo "missing dependency: $bin"; exit 1; }; done
[ -f .env ] || cp .env.example .env

# -----------------------------------------------------------------------------
hdr "0. Boot the stack (postgres · redis · gateway · jaeger · worker · dashboard)"
"${COMPOSE[@]}" up -d
printf '  waiting for gateway health'
for _ in $(seq 1 90); do
  if curl -fsS "$GATEWAY/health" >/dev/null 2>&1; then echo " — up"; break; fi
  printf '.'; sleep 1
done
curl -fsS "$GATEWAY/health" >/dev/null 2>&1 || { echo; bad "gateway never became healthy (see: ${COMPOSE[*]} logs gateway)"; exit 1; }

# -----------------------------------------------------------------------------
hdr "1. Register a demo agent version: deny-by-default allowlist + approval gate + hard budget"
# The allow-tool is registered REVERSIBLE so the reversibility ladder leaves it
# ALLOW (an unregistered tool defaults to irreversible → approval).
ALLOW_TOOL="read_file_$SUF"; APPROVE_TOOL="write_file_$SUF"; DENY_TOOL="exfiltrate_secrets_$SUF"
api -X POST "$GATEWAY/v1/registry/tools" -d "{
  \"name\":\"Demo Read\",\"slug\":\"$ALLOW_TOOL\",\"mcp_server\":\"demo\",
  \"risk_level\":\"read\",\"reversibility\":\"reversible\",
  \"input_schema\":{\"type\":\"object\"}}" >/dev/null
api -X POST "$GATEWAY/v1/registry/agents/$AGENT/versions" -d "{
  \"version\":\"demo-$SUF\",\"system_prompt\":\"demo\",\"model\":\"claude-sonnet-4-20250514\",
  \"allowed_tools\":[\"$ALLOW_TOOL\"],
  \"approval_required_tools\":[\"$APPROVE_TOOL\"],
  \"denied_tools\":[\"$DENY_TOOL\"],
  \"max_cost_cents\":5,\"max_tool_calls\":10}" >/dev/null
ok "registered version demo-$SUF  (allow=[$ALLOW_TOOL] approval=[$APPROVE_TOOL] deny=[$DENY_TOOL], budget=\$0.05)"

# -----------------------------------------------------------------------------
hdr "2. Create a run under that deny-by-default budget"
RUN="$(api -X POST "$GATEWAY/v1/runs" -d "{\"agent_id\":\"$AGENT\",\"input\":{\"task\":\"governance demo\"}}" | jq -r '.id')"
if [ -n "$RUN" ] && [ "$RUN" != null ]; then ok "run $RUN created"; else bad "run not created"; exit 1; fi

# -----------------------------------------------------------------------------
hdr "3. Drive the policy engine (POST /v1/runs/{id}/check-tool) — the governance proof"
check() { api -X POST "$GATEWAY/v1/runs/$RUN/check-tool" -d "{\"tool_name\":\"$1\"}"; }

A="$(check "$ALLOW_TOOL")"
if [ "$(jq -r '.allowed and (.requires_approval|not)' <<<"$A")" = true ]; then
  ok "ALLOW    $ALLOW_TOOL → allowed=true  (deny-by-default allowlist match)"
else
  bad "ALLOW    $ALLOW_TOOL → $(jq -c '{allowed,requires_approval,reason}' <<<"$A")"
fi

G="$(check "$APPROVE_TOOL")"
if [ "$(jq -r '.requires_approval' <<<"$G")" = true ]; then
  ok "APPROVAL $APPROVE_TOOL → requires_approval=true  (human-in-the-loop gate tripped)"
else
  bad "APPROVAL $APPROVE_TOOL → $(jq -c '{allowed,requires_approval,reason}' <<<"$G")"
fi

D="$(check "$DENY_TOOL")"
if [ "$(jq -r '.allowed' <<<"$D")" = false ]; then
  ok "DENY     $DENY_TOOL → allowed=false  (explicit deny / deny-by-default)"
else
  bad "DENY     $DENY_TOOL → $(jq -c '{allowed,requires_approval,reason}' <<<"$D")"
fi

# -----------------------------------------------------------------------------
hdr "4. Immutable audit trail — every decision was appended (no UPDATE/DELETE path exists)"
"${COMPOSE[@]}" exec -T postgres psql -U ferrumdeck -d ferrumdeck -P pager=off -c \
  "SELECT action, resource_type, actor_type, occurred_at
     FROM audit_events
    WHERE run_id = '$RUN'
    ORDER BY occurred_at ASC;" || bad "could not read audit_events"

# -----------------------------------------------------------------------------
hdr "5. Run state + the budget the platform is enforcing"
api "$GATEWAY/v1/runs/$RUN" | jq '{status, cost_cents, tool_calls, response_level, budget_breach_projected}'
echo "  (budget auto-kill fires on step submission over the cap — see Part B / submit_step_result)"

# -----------------------------------------------------------------------------
hdr "6. OTel / GenAI spans — every enforce decision is one"
echo "  Jaeger UI:  http://localhost:16686   (service: \"gateway\")"
echo "  Dashboard:  http://localhost:8000"
# The denied tool call above is emitted as a GenAI decision span carrying
# ferrumdeck.decision=deny (see fd_otel::decision). Span export is async/batched,
# so confirm it with a short retry — this is a soft check (it reports, it never
# fails the demo; open the UI and filter tag ferrumdeck.decision=deny to see it).
JAEGER="${JAEGER:-http://localhost:16686}"
found_decision=""
for _ in $(seq 1 12); do
  if curl -fsS "$JAEGER/api/traces?service=gateway&lookback=1h&limit=50" 2>/dev/null \
       | jq -e '[.data[].spans[].tags[]?
                 | select(.key=="ferrumdeck.decision" and .value=="deny")]
                 | length > 0' >/dev/null 2>&1; then
    found_decision=1; break
  fi
  sleep 1
done
if [ -n "$found_decision" ]; then
  ok "denied tool call surfaced as a GenAI span with ferrumdeck.decision=deny"
else
  echo "  (decision spans still flushing — open Jaeger and filter tag ferrumdeck.decision=deny)"
fi

# -----------------------------------------------------------------------------
hdr "7. Golden-trace replay (deterministic metric wire-contract regression — pure, no stack)"
uv run pytest python/packages/fd-evals/tests/test_tool_call_firing_rate_golden.py -q 2>&1 | tail -3

# -----------------------------------------------------------------------------
hdr "8. Coherence-divergence live-fire (deterministic — a drifting run is caught + R-tiered)"
# Feeds a deliberately drifting trajectory through the SAME detection core the
# live gateway runs on each step; shows the divergence, the R1-R3 rung, and the
# shadow/enforce response + the coherence.divergence.detected SSE shape. Pure,
# self-verifying (exits non-zero if the drift is NOT caught).
if uv run python examples/demo/coherence-drift.py; then
  ok "coherence divergence fired on the drifting run and mapped to an R-tier"
else
  bad "coherence-divergence proof failed"
fi
echo "  Live signal (Part B / real agentic run): a divergence writes an"
echo "  audit_events row with violation_type=coherence_divergence, emits the SSE"
echo "  event, and surfaces on the run's Coherence card. Set FERRUMDECK_COHERENCE_MODE=enforce"
echo "  to gate an R3 divergence (run → WaitingApproval) instead of only recording it."

# -----------------------------------------------------------------------------
printf '\n%s\n' "$(c '1;36' '════════════════════════════════════════════')"
if [ "$FAIL" -eq 0 ]; then
  printf '%s  %d governance assertions passed.\n' "$(c '1;32' 'DEMO OK ✓')" "$PASS"
else
  printf '%s  %d passed, %d FAILED.\n' "$(c '1;31' 'DEMO FAILED ✗')" "$PASS" "$FAIL"
fi
printf '%s\n' "$(c '1;36' '════════════════════════════════════════════')"
echo "Optional full agentic loop (needs ANTHROPIC_API_KEY): ANTHROPIC_API_KEY=sk-... make eval-run"
echo "Tear down: make dev-down"
exit "$FAIL"
