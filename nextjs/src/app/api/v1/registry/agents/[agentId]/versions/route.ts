import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders } from "@/lib/api/config";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params;
    const { searchParams } = new URL(request.url);

    const response = await fetch(
      `${getGatewayUrl()}/v1/registry/agents/${agentId}/versions?${searchParams}`,
      {
        headers: getAuthHeaders(),
      }
    );

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error fetching agent versions:", error);
    return NextResponse.json(
      { error: "Failed to fetch agent versions" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params;
    const body = await request.json();

    const response = await fetch(
      `${getGatewayUrl()}/v1/registry/agents/${agentId}/versions`,
      {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(body),
      }
    );

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error creating agent version:", error);
    return NextResponse.json(
      { error: "Failed to create agent version" },
      { status: 500 }
    );
  }
}
