import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders } from "@/lib/api/config";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;

    const response = await fetch(`${getGatewayUrl()}/v1/runs/${runId}/cancel`, {
      method: "POST",
      headers: getAuthHeaders(),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error cancelling run:", error);
    return NextResponse.json(
      { error: "Failed to cancel run" },
      { status: 500 }
    );
  }
}
