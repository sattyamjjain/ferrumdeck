import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders } from "@/lib/api/config";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ toolId: string }> }
) {
  try {
    const { toolId } = await params;

    const response = await fetch(`${getGatewayUrl()}/v1/registry/tools/${toolId}/policy`, {
      headers: getAuthHeaders(),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error fetching tool policy:", error);
    return NextResponse.json(
      { error: "Failed to fetch tool policy" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ toolId: string }> }
) {
  try {
    const { toolId } = await params;
    const body = await request.json();

    const response = await fetch(`${getGatewayUrl()}/v1/registry/tools/${toolId}/policy`, {
      method: "PATCH",
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });

    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error updating tool policy:", error);
    return NextResponse.json(
      { error: "Failed to update tool policy" },
      { status: 500 }
    );
  }
}
