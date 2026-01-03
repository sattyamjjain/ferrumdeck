import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders } from "@/lib/api/config";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ toolId: string; versionId: string }> }
) {
  try {
    const { toolId, versionId } = await params;

    const response = await fetch(
      `${getGatewayUrl()}/v1/registry/tools/${toolId}/versions/${versionId}`,
      {
        headers: getAuthHeaders(),
      }
    );

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error fetching tool version:", error);
    return NextResponse.json(
      { error: "Failed to fetch tool version" },
      { status: 500 }
    );
  }
}
