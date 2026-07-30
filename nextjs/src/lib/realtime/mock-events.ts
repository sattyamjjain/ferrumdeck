/**
 * SSE realtime event shapes + the opt-in synthetic-event generator.
 *
 * This module is the single source of truth for the wire shapes of the run
 * stream's governance events, used until the gateway->BFF push lands
 * (ROADMAP #5). It can SYNTHESISE those events for local wire-shape development,
 * but only when the `FERRUMDECK_SSE_MOCK_EVENTS` env var is "1"/"true". It is
 * **OFF by default in every environment** — a fabricated enforcement verdict
 * (a synthetic R3 gate, a made-up policy decision) must never reach an
 * operator's console. When off, `startMockEventStream` creates no timer at all.
 */

/** Env var that opts into the synthetic SSE event generator (default OFF). */
export const SSE_MOCK_EVENTS_ENV = "FERRUMDECK_SSE_MOCK_EVENTS";

/**
 * Whether the synthetic SSE event generator is enabled. True ONLY for the
 * literal values "1" or "true" (case-insensitive). Off by default in every
 * environment, development included: a demo that shows nothing is honest; a
 * demo that shows a fabricated R3 gate is not.
 */
export function sseMockEventsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env[SSE_MOCK_EVENTS_ENV] ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true";
}

export interface SSEEvent {
  id: string;
  type: string;
  channel: string;
  timestamp: string;
  payload: unknown;
}

/**
 * Generate a unique event ID
 */
export function generateEventId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Generate mock events for testing based on channel type
 */
export function generateMockEvent(channelType: string, channelName: string): SSEEvent | null {
  const timestamp = new Date().toISOString();
  const id = generateEventId();

  switch (channelType) {
    case "runs": {
      const eventTypes = ["run_status_changed", "run_created", "run_completed"];
      const eventType = eventTypes[Math.floor(Math.random() * eventTypes.length)];

      if (eventType === "run_status_changed") {
        return {
          id,
          type: "run_status_changed",
          channel: channelName,
          timestamp,
          payload: {
            run_id: `run_${Date.now().toString(36)}`,
            previous_status: "running",
            new_status: Math.random() > 0.5 ? "completed" : "waiting_approval",
          },
        };
      } else if (eventType === "run_created") {
        return {
          id,
          type: "run_created",
          channel: channelName,
          timestamp,
          payload: {
            run: {
              id: `run_${Date.now().toString(36)}`,
              project_id: "prj_demo",
              agent_version_id: "agv_demo",
              status: "queued",
              input: { task: "Demo task" },
              input_tokens: 0,
              output_tokens: 0,
              tool_calls: 0,
              cost_cents: 0,
              created_at: timestamp,
            },
          },
        };
      } else {
        return {
          id,
          type: "run_completed",
          channel: channelName,
          timestamp,
          payload: {
            run_id: `run_${Date.now().toString(36)}`,
            status: "completed",
            usage: {
              input_tokens: Math.floor(Math.random() * 1000),
              output_tokens: Math.floor(Math.random() * 500),
              tool_calls: Math.floor(Math.random() * 5),
              cost_cents: Math.floor(Math.random() * 10),
            },
          },
        };
      }
    }

    case "run": {
      const eventTypes = [
        "step_created",
        "step_status_changed",
        "step_completed",
        "run.forecast.updated",
        "policy.decision.explained",
        "policy.response.recorded",
        "routing.decision.recorded",
        "coherence.divergence.detected",
      ];
      const eventType = eventTypes[Math.floor(Math.random() * eventTypes.length)];
      const runId = channelName.split(":")[1] || "run_demo";

      if (eventType === "policy.response.recorded") {
        // Reversibility-aware graduated response (DeepMind AI Control Roadmap
        // R1-R3 ladder). The gateway picks a rung per tool call from the
        // tool's reversibility + the run's budget headroom. This mock locks in
        // the SSE wire shape; the console renders the rung from the polled run
        // endpoint today (gateway -> BFF push deferred, same pattern as
        // run.forecast.updated). See docs/runbooks/graduated-response-levels.md.
        const variants = [
          { reversibility: "reversible", response_level: "allow_and_log" },
          { reversibility: "costly", response_level: "allow_under_budget" },
          { reversibility: "irreversible", response_level: "require_approval" },
        ] as const;
        const pick = variants[Math.floor(Math.random() * variants.length)];
        return {
          id,
          type: "policy.response.recorded",
          channel: channelName,
          timestamp,
          payload: {
            run_id: runId,
            tool_name: "write_file",
            response_level: pick.response_level,
            reversibility: pick.reversibility,
            at: timestamp,
          },
        };
      }

      if (eventType === "policy.decision.explained") {
        // Policy-conflict resolution explanation trace. Emitted each time a
        // tool-call decision is reached, so dashboards can show "why was
        // this denied/approved" without re-running the engine. See
        // docs/runbooks/policy-conflict-resolution.md for the contract.
        const variants = [
          {
            winning: { kind: "deny", source: "allowlist:denied" },
            overrides: [
              { kind: "allow", source: "allowlist:allowed" },
              { kind: "requires_approval", source: "allowlist:approval" },
            ],
          },
          {
            winning: { kind: "requires_approval", source: "allowlist:approval" },
            overrides: [{ kind: "allow", source: "allowlist:allowed" }],
          },
          {
            winning: { kind: "allow", source: "allowlist:allowed" },
            overrides: [],
          },
        ];
        const pick = variants[Math.floor(Math.random() * variants.length)];
        return {
          id,
          type: "policy.decision.explained",
          channel: channelName,
          timestamp,
          payload: {
            run_id: runId,
            tool_name: "write_file",
            decision_id: `pld_${Date.now().toString(36)}`,
            winning_kind: pick.winning.kind,
            winning_source: pick.winning.source,
            overrides: pick.overrides.map((o) => ({
              kind: o.kind,
              source: o.source,
              overridden_by: pick.winning.kind,
              reason: `overridden by higher-precedence ${pick.winning.kind} verdict (deny > requires_approval > budget_cap > allow)`,
            })),
            precedence: "deny > requires_approval > budget_cap > allow",
            at: timestamp,
          },
        };
      }

      if (eventType === "routing.decision.recorded") {
        // Multi-agent routing-decision audit record. Emitted by the gateway
        // every time the orchestrator binds a subtask to a concrete
        // agent / role / model. Anchor: AgensFlow (arXiv:2605.27466). The
        // full record shape matches `RoutingDecisionResponse` from the
        // gateway's `/v1/runs/{id}/routing` endpoint; this mock locks in
        // the SSE wire shape so the dashboard can ship before the gateway
        // → BFF push wiring lands (same pattern as `policy.decision.explained`
        // and `run.forecast.updated`).
        const reasonCodes = [
          "policy_match",
          "budget_within_limits",
          "approval_gate",
          "skip",
          "fallback_default",
        ] as const;
        const reasonCode = reasonCodes[Math.floor(Math.random() * reasonCodes.length)];
        return {
          id,
          type: "routing.decision.recorded",
          channel: channelName,
          timestamp,
          payload: {
            run_id: runId,
            decision_id: `rtg_${Date.now().toString(36)}`,
            subtask_id: `stp_${Date.now().toString(36)}`,
            candidates: [
              {
                role: "planner",
                agent_id: "agt_plan_alpha",
                model: "claude-opus-4-7",
                score: 0.91,
              },
              {
                role: "planner",
                agent_id: "agt_plan_beta",
                model: "gpt-4o",
                score: 0.74,
              },
            ],
            chosen: {
              role: "planner",
              agent_id: "agt_plan_alpha",
              model: "claude-opus-4-7",
            },
            reason: {
              code: reasonCode,
              detail: `mock routing-decision reason: ${reasonCode}`,
            },
            content_hash:
              "0000000000000000000000000000000000000000000000000000000000000000",
            anchor: "arXiv:2605.27466",
            at: timestamp,
          },
        };
      }

      if (eventType === "coherence.divergence.detected") {
        // Coherence-divergence signal (Strained Coherence, arXiv:2606.07889).
        // Emitted by the gateway the instant the live monitor surfaces a
        // stated-blocking-fact -> contradicting-closure-action divergence on the
        // run trajectory. `response_level` is the reversibility-ladder rung the
        // divergence maps to (severity -> R1/R2/R3); `gated` is true only in
        // enforce mode when an R3 rung halts the run. This mock locks in the SSE
        // wire shape; the console reads the persisted flag + rung from the polled
        // run endpoint today (gateway -> BFF push deferred, same pattern as
        // run.forecast.updated / routing.decision.recorded). See
        // docs/runbooks/coherence-divergence.md for the contract.
        const variants = [
          {
            category: "test_failure",
            stated_fact: "tests still failing on CI",
            contradicting_action: "set_status: mark task complete",
            response_level: "require_approval",
            response_rung: "R3",
          },
          {
            category: "permission_denied",
            stated_fact: "write failed: permission denied",
            contradicting_action: "git_commit: commit the change",
            response_level: "require_approval",
            response_rung: "R3",
          },
          {
            category: "missing_resource",
            stated_fact: "config.yaml does not exist",
            contradicting_action: "report: completed successfully",
            response_level: "allow_under_budget",
            response_rung: "R2",
          },
        ] as const;
        const pick = variants[Math.floor(Math.random() * variants.length)];
        // Mock is shadow-mode (never gated); enforce is opt-in server-side.
        return {
          id,
          type: "coherence.divergence.detected",
          channel: channelName,
          timestamp,
          payload: {
            run_id: runId,
            category: pick.category,
            confidence: 0.9,
            response_level: pick.response_level,
            response_rung: pick.response_rung,
            gated: false,
            mode: "shadow",
            stated_fact: pick.stated_fact,
            contradicting_action: pick.contradicting_action,
            anchor: "arxiv:2606.07889",
            at: timestamp,
          },
        };
      }

      if (eventType === "run.forecast.updated") {
        // Predictive run-budget forecast snapshot. Emitted by the gateway
        // after each step is recorded. See docs/runbooks/budget-forecast.md
        // for the schema contract.
        const projected = Math.floor(Math.random() * 800) + 200;
        const breach = projected > 500;
        return {
          id,
          type: "run.forecast.updated",
          channel: channelName,
          timestamp,
          payload: {
            run_id: runId,
            projected_cost_cents: projected,
            ewma_cost_cents: Math.max(0, projected - Math.floor(Math.random() * 50)),
            budget_breach_projected: breach,
            breach_kind: breach ? "cost_cents" : null,
            at: timestamp,
          },
        };
      }

      if (eventType === "step_created") {
        return {
          id,
          type: "step_created",
          channel: channelName,
          timestamp,
          payload: {
            step: {
              id: `stp_${Date.now().toString(36)}`,
              run_id: runId,
              step_number: Math.floor(Math.random() * 10) + 1,
              step_type: Math.random() > 0.5 ? "llm" : "tool",
              status: "pending",
              input: {},
              created_at: timestamp,
            },
          },
        };
      } else if (eventType === "step_status_changed") {
        return {
          id,
          type: "step_status_changed",
          channel: channelName,
          timestamp,
          payload: {
            step_id: `stp_${Date.now().toString(36)}`,
            run_id: runId,
            previous_status: "pending",
            new_status: "running",
          },
        };
      } else {
        return {
          id,
          type: "step_completed",
          channel: channelName,
          timestamp,
          payload: {
            step_id: `stp_${Date.now().toString(36)}`,
            run_id: runId,
            status: "completed",
            input_tokens: Math.floor(Math.random() * 100),
            output_tokens: Math.floor(Math.random() * 200),
          },
        };
      }
    }

    case "approvals": {
      const eventTypes = ["approval_created", "approval_resolved"];
      const eventType = eventTypes[Math.floor(Math.random() * eventTypes.length)];

      if (eventType === "approval_created") {
        return {
          id,
          type: "approval_created",
          channel: channelName,
          timestamp,
          payload: {
            approval: {
              id: `apr_${Date.now().toString(36)}`,
              run_id: `run_${Date.now().toString(36)}`,
              step_id: `stp_${Date.now().toString(36)}`,
              policy_decision_id: `pld_${Date.now().toString(36)}`,
              action_type: "tool_call",
              action_details: { tool: "file_write", path: "/etc/config" },
              tool_name: "file_write",
              reason: "Write access to sensitive path requires approval",
              status: "pending",
              risk_level: "high",
              created_at: timestamp,
              expires_at: new Date(Date.now() + 3600000).toISOString(),
            },
          },
        };
      } else {
        return {
          id,
          type: "approval_resolved",
          channel: channelName,
          timestamp,
          payload: {
            approval_id: `apr_${Date.now().toString(36)}`,
            status: Math.random() > 0.3 ? "approved" : "rejected",
            resolved_by: "user_admin",
            resolved_at: timestamp,
            resolution_note: "Action reviewed and approved",
          },
        };
      }
    }

    case "audit": {
      return {
        id,
        type: "audit_event_created",
        channel: channelName,
        timestamp,
        payload: {
          id: `aev_${Date.now().toString(36)}`,
          event_type: "run.status_changed",
          actor_type: "system",
          actor_id: "worker_1",
          resource_type: "run",
          resource_id: `run_${Date.now().toString(36)}`,
          action: "status_change",
          metadata: {
            from_status: "running",
            to_status: "completed",
          },
          created_at: timestamp,
        },
      };
    }

    default:
      return null;
  }
}

/**
 * Start the synthetic-event stream for a channel. Returns `null` and creates
 * NO timer when `sseMockEventsEnabled` is false (the default), so a caller that
 * forgets to check the flag still cannot leak fabricated events. When enabled,
 * a `generateMockEvent` for the channel is produced on each interval and handed
 * to `onEvent`.
 */
export function startMockEventStream(opts: {
  channelType: string;
  channelName: string;
  intervalMs: number;
  onEvent: (e: SSEEvent) => void;
  env?: NodeJS.ProcessEnv;
}): ReturnType<typeof setInterval> | null {
  if (!sseMockEventsEnabled(opts.env ?? process.env)) {
    return null;
  }
  return setInterval(() => {
    const event = generateMockEvent(opts.channelType, opts.channelName);
    if (event) {
      opts.onEvent(event);
    }
  }, opts.intervalMs);
}
