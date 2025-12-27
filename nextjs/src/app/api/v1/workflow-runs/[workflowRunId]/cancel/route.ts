import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders } from "@/lib/api/config";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowRunId: string }> }
) {
  try {
    const { workflowRunId } = await params;

    const response = await fetch(
      `${getGatewayUrl()}/v1/workflow-runs/${workflowRunId}/cancel`,
      {
        method: "POST",
        headers: getAuthHeaders(),
      }
    );

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error cancelling workflow run:", error);
    return NextResponse.json(
      { error: "Failed to cancel workflow run" },
      { status: 500 }
    );
  }
}
