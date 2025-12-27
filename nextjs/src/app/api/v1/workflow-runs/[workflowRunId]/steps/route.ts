import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders } from "@/lib/api/config";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workflowRunId: string }> }
) {
  try {
    const { workflowRunId } = await params;
    const { searchParams } = new URL(request.url);

    const response = await fetch(
      `${getGatewayUrl()}/v1/workflow-runs/${workflowRunId}/steps?${searchParams}`,
      {
        headers: getAuthHeaders(),
      }
    );

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error fetching workflow step executions:", error);
    return NextResponse.json(
      { error: "Failed to fetch workflow step executions" },
      { status: 500 }
    );
  }
}
