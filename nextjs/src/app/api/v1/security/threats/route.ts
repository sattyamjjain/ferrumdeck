import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders } from "@/lib/api/config";

/**
 * GET /api/v1/security/threats
 * Fetch threats with optional filtering
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const response = await fetch(
      `${getGatewayUrl()}/v1/security/threats?${searchParams}`,
      {
        headers: getAuthHeaders(),
      }
    );

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error fetching threats:", error);
    return NextResponse.json(
      { error: "Failed to fetch threats" },
      { status: 500 }
    );
  }
}
