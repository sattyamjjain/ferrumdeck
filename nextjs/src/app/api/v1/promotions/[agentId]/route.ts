import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders } from "@/lib/api/config";

/**
 * Promotion history for an agent — champion vs challenger + gate status.
 *
 * Proxies the gateway's `GET /v1/promotions/:agentId` read endpoint, which
 * reads the immutable audit trail filtered by `action = "promotion.decided"`.
 * Returns an empty decision list (not an error) when the gateway is
 * unavailable so the panel degrades gracefully.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  try {
    const response = await fetch(`${getGatewayUrl()}/v1/promotions/${agentId}`, {
      headers: getAuthHeaders(),
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error fetching promotion history:", error);
    return NextResponse.json(
      { agent_id: agentId, decisions: [], anchor: "champion-challenger" },
      { status: 200 }
    );
  }
}
