import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders } from "@/lib/api/config";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ keyId: string }> }
) {
  try {
    const { keyId } = await params;

    const response = await fetch(`${getGatewayUrl()}/v1/api-keys/${keyId}`, {
      headers: getAuthHeaders(),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error fetching API key:", error);
    return NextResponse.json(
      { error: "Failed to fetch API key" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ keyId: string }> }
) {
  try {
    const { keyId } = await params;
    const body = await request.json().catch(() => ({}));

    const response = await fetch(`${getGatewayUrl()}/v1/api-keys/${keyId}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });

    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error revoking API key:", error);
    return NextResponse.json(
      { error: "Failed to revoke API key" },
      { status: 500 }
    );
  }
}
