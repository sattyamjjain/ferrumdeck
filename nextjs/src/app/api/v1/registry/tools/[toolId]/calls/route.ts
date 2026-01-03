import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders } from "@/lib/api/config";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ toolId: string }> }
) {
  try {
    const { toolId } = await params;
    const { searchParams } = new URL(request.url);

    const response = await fetch(
      `${getGatewayUrl()}/v1/registry/tools/${toolId}/calls?${searchParams}`,
      {
        headers: getAuthHeaders(),
      }
    );

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error fetching tool calls:", error);
    return NextResponse.json(
      { error: "Failed to fetch tool calls" },
      { status: 500 }
    );
  }
}
