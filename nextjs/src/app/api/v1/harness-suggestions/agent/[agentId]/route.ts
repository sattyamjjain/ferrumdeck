import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders } from "@/lib/api/config";

/**
 * Harness/policy suggestions for an agent (newest-first) + their folded review
 * status.
 *
 * Proxies the gateway's `GET /v1/harness-suggestions/agent/:agentId` read
 * endpoint, which reads the immutable audit trail filtered by the
 * `harness.suggestion.*` actions. Returns an empty suggestion list (not an
 * error) when the gateway is unavailable so the panel degrades gracefully.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  try {
    const response = await fetch(
      `${getGatewayUrl()}/v1/harness-suggestions/agent/${agentId}`,
      { headers: getAuthHeaders() }
    );
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error fetching harness suggestions:", error);
    return NextResponse.json(
      { agent_id: agentId, suggestions: [], anchor: "harnessx-trace-to-delta" },
      { status: 200 }
    );
  }
}
