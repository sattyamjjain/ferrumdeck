import { NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders } from "@/lib/api/config";

/**
 * GET /api/v1/security/threats/:threatId
 * Fetch a single threat by ID
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ threatId: string }> }
) {
  try {
    const { threatId } = await context.params;

    const response = await fetch(
      `${getGatewayUrl()}/v1/security/threats/${threatId}`,
      {
        headers: getAuthHeaders(),
      }
    );

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error fetching threat:", error);
    return NextResponse.json(
      { error: "Failed to fetch threat" },
      { status: 500 }
    );
  }
}
