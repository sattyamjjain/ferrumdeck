import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders } from "@/lib/api/config";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;

    const response = await fetch(`${getGatewayUrl()}/v1/runs/${runId}/steps`, {
      headers: getAuthHeaders(),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error fetching steps:", error);
    return NextResponse.json(
      { error: "Failed to fetch steps" },
      { status: 500 }
    );
  }
}
