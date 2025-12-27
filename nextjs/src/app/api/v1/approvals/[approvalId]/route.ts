import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders } from "@/lib/api/config";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ approvalId: string }> }
) {
  try {
    const { approvalId } = await params;
    const body = await request.json();

    const response = await fetch(`${getGatewayUrl()}/v1/approvals/${approvalId}`, {
      method: "PUT",
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error resolving approval:", error);
    return NextResponse.json(
      { error: "Failed to resolve approval" },
      { status: 500 }
    );
  }
}
