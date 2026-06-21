import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders } from "@/lib/api/config";

/**
 * Approve or reject a proposed harness suggestion.
 *
 * Proxies the gateway's `POST /v1/harness-suggestions/:suggestionId/resolve`
 * write endpoint, which records the operator's decision in the immutable audit
 * trail. It does NOT apply the change to any live policy/allowlist/budget —
 * human-in-the-loop is preserved.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ suggestionId: string }> }
) {
  const { suggestionId } = await params;
  try {
    const body = await request.text();
    const response = await fetch(
      `${getGatewayUrl()}/v1/harness-suggestions/${suggestionId}/resolve`,
      { method: "POST", headers: getAuthHeaders(), body }
    );
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error resolving harness suggestion:", error);
    return NextResponse.json(
      { error: "Failed to resolve harness suggestion" },
      { status: 500 }
    );
  }
}
