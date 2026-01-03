import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders } from "@/lib/api/config";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ toolId: string }> }
) {
  try {
    const { toolId } = await params;

    const response = await fetch(`${getGatewayUrl()}/v1/registry/tools/${toolId}/versions`, {
      headers: getAuthHeaders(),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error fetching tool versions:", error);
    return NextResponse.json(
      { error: "Failed to fetch tool versions" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ toolId: string }> }
) {
  try {
    const { toolId } = await params;
    const body = await request.json();

    const response = await fetch(`${getGatewayUrl()}/v1/registry/tools/${toolId}/versions`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error creating tool version:", error);
    return NextResponse.json(
      { error: "Failed to create tool version" },
      { status: 500 }
    );
  }
}
