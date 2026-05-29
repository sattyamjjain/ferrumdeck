import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders } from "@/lib/api/config";
import type {
  AgentFiringRateResponse,
  FiringRate,
  FiringRatePoint,
} from "@/types/metrics";

// Default low-firing-rate alert threshold — mirrors
// `fd_otel::firing_rate::DEFAULT_LOW_FIRING_RATE_THRESHOLD` and
// `fd_runtime.tracing.FD_TOOL_FIRING_DEFAULT_THRESHOLD`. Operators can
// override via the `?threshold=` query param.
const DEFAULT_LOW_THRESHOLD = 0.4;
const DEFAULT_WINDOW_HOURS = 24;

/**
 * Tool-call firing-rate over a sliding window.
 *
 * Wire shape is locked in here so the dashboard can ship ahead of the
 * gateway-side compute (same "schema first, wiring second" pattern used for
 * `run.forecast.updated`, `policy.decision.explained`, and the SchemaDriftGuard
 * surface). When the gateway exposes
 * `/v1/registry/agents/:agentId/tool-call-firing-rate`, the upstream proxy
 * branch below replaces the deterministic mock — the response shape stays
 * the same so no dashboard change is needed.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const search = request.nextUrl.searchParams;
  const windowHours = clampWindow(search.get("window_hours"));
  const threshold = clampThreshold(search.get("threshold"));

  const upstream = `${getGatewayUrl()}/v1/registry/agents/${agentId}/tool-call-firing-rate?window_hours=${windowHours}&threshold=${threshold}`;
  try {
    const response = await fetch(upstream, {
      headers: getAuthHeaders(),
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      const data = (await response.json()) as AgentFiringRateResponse;
      return NextResponse.json(data, { status: 200 });
    }
    // Anything other than 200 falls through to the deterministic mock so
    // the dashboard stays usable while the gateway endpoint is rolling out.
  } catch {
    // network / timeout / abort — fall through to mock.
  }

  const mock = buildDeterministicMock(agentId, windowHours, threshold);
  return NextResponse.json(mock, {
    status: 200,
    headers: { "x-fd-firing-rate-source": "bff-mock" },
  });
}

function clampWindow(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0 && parsed <= 24 * 14) {
    return parsed;
  }
  return DEFAULT_WINDOW_HOURS;
}

function clampThreshold(raw: string | null): number {
  const parsed = Number.parseFloat(raw ?? "");
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
    return parsed;
  }
  return DEFAULT_LOW_THRESHOLD;
}

/**
 * Deterministic mock derived from the agent id so each agent's panel
 * renders a stable trend without a real gateway. Same id + same window →
 * same response; the dashboard can be screenshotted, the playwright tests
 * can pin against it.
 */
function buildDeterministicMock(
  agentId: string,
  windowHours: number,
  threshold: number
): AgentFiringRateResponse {
  const seed = seedFromAgentId(agentId);
  const pointCount = Math.min(windowHours, 24);
  const now = Date.UTC(2026, 4, 29, 12, 0, 0);

  const points: FiringRatePoint[] = [];
  let reasoningTotal = 0;
  let invokingTotal = 0;

  for (let i = 0; i < pointCount; i++) {
    const reasoning = 6 + (seed.r(i) % 7);
    const baseInvoking = Math.round(reasoning * (0.30 + seed.f(i) * 0.55));
    const invoking = Math.min(reasoning, Math.max(0, baseInvoking));
    const rate = reasoning > 0 ? invoking / reasoning : 0;
    const completedAt = new Date(
      now - (pointCount - 1 - i) * 3600 * 1000
    ).toISOString();
    points.push({
      run_id: `run_mock_${agentId.slice(0, 6)}_${i.toString().padStart(2, "0")}`,
      completed_at: completedAt,
      rate,
      reasoning_steps: reasoning,
      invoking_steps: invoking,
      low_firing_rate_breached: reasoning > 0 && rate < threshold,
    });
    reasoningTotal += reasoning;
    invokingTotal += invoking;
  }

  const windowAggregate: FiringRate = {
    reasoning_steps: reasoningTotal,
    invoking_steps: invokingTotal,
    rate: reasoningTotal > 0 ? invokingTotal / reasoningTotal : 0,
    low_firing_rate_breached:
      reasoningTotal > 0 && invokingTotal / reasoningTotal < threshold,
    low_firing_rate_threshold: threshold,
  };

  return {
    agent_id: agentId,
    window_hours: windowHours,
    anchor_attribute: "ferrumdeck.metrics.tool_call_firing_rate",
    window: windowAggregate,
    points,
    computed_at: new Date(now).toISOString(),
  };
}

/** Tiny deterministic PRNG keyed off the agent id. Not security-sensitive. */
function seedFromAgentId(agentId: string) {
  let acc = 0;
  for (const ch of agentId) {
    acc = (acc * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return {
    r(i: number) {
      const v = (acc + i * 2654435761) >>> 0;
      return v % 100;
    },
    f(i: number) {
      const v = (acc + i * 16807) >>> 0;
      return (v % 1000) / 1000;
    },
  };
}
