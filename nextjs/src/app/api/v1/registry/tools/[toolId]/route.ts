import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders } from "@/lib/api/config";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ toolId: string }> }
) {
  try {
    const { toolId } = await params;

    const response = await fetch(`${getGatewayUrl()}/v1/registry/tools/${toolId}`, {
      headers: getAuthHeaders(),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error fetching tool:", error);
    return NextResponse.json(
      { error: "Failed to fetch tool" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ toolId: string }> }
) {
  try {
    const { toolId } = await params;
    const body = await request.json();

    const response = await fetch(`${getGatewayUrl()}/v1/registry/tools/${toolId}`, {
      method: "PUT",
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error updating tool:", error);
    return NextResponse.json(
      { error: "Failed to update tool" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ toolId: string }> }
) {
  try {
    const { toolId } = await params;

    const response = await fetch(`${getGatewayUrl()}/v1/registry/tools/${toolId}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });

    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error deleting tool:", error);
    return NextResponse.json(
      { error: "Failed to delete tool" },
      { status: 500 }
    );
  }
}
