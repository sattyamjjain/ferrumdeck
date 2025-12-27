import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders } from "@/lib/api/config";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const response = await fetch(`${getGatewayUrl()}/v1/approvals?${searchParams}`, {
      headers: getAuthHeaders(),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error fetching approvals:", error);
    return NextResponse.json(
      { error: "Failed to fetch approvals" },
      { status: 500 }
    );
  }
}
