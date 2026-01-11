import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders } from "@/lib/api/config";

/**
 * GET /api/v1/security/config
 * Fetch Airlock configuration
 */
export async function GET() {
  try {
    const response = await fetch(`${getGatewayUrl()}/v1/security/config`, {
      headers: getAuthHeaders(),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error fetching Airlock config:", error);
    return NextResponse.json(
      { error: "Failed to fetch Airlock configuration" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/v1/security/config
 * Update Airlock configuration
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch(`${getGatewayUrl()}/v1/security/config`, {
      method: "PUT",
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error updating Airlock config:", error);
    return NextResponse.json(
      { error: "Failed to update Airlock configuration" },
      { status: 500 }
    );
  }
}
