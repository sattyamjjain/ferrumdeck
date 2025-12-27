import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders } from "@/lib/api/config";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId } = await params;
    const { searchParams } = new URL(request.url);

    const response = await fetch(
      `${getGatewayUrl()}/v1/workflows/${workflowId}/runs?${searchParams}`,
      {
        headers: getAuthHeaders(),
      }
    );

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error fetching workflow runs:", error);
    return NextResponse.json(
      { error: "Failed to fetch workflow runs" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId } = await params;
    const body = await request.json();

    const response = await fetch(
      `${getGatewayUrl()}/v1/workflows/${workflowId}/runs`,
      {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(body),
      }
    );

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error creating workflow run:", error);
    return NextResponse.json(
      { error: "Failed to create workflow run" },
      { status: 500 }
    );
  }
}
