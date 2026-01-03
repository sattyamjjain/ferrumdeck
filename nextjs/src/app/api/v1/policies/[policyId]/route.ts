import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders } from "@/lib/api/config";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ policyId: string }> }
) {
  try {
    const { policyId } = await params;

    const response = await fetch(`${getGatewayUrl()}/v1/policies/${policyId}`, {
      headers: getAuthHeaders(),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error fetching policy:", error);
    return NextResponse.json(
      { error: "Failed to fetch policy" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ policyId: string }> }
) {
  try {
    const { policyId } = await params;
    const body = await request.json();

    const response = await fetch(`${getGatewayUrl()}/v1/policies/${policyId}`, {
      method: "PATCH",
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error updating policy:", error);
    return NextResponse.json(
      { error: "Failed to update policy" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ policyId: string }> }
) {
  try {
    const { policyId } = await params;

    const response = await fetch(`${getGatewayUrl()}/v1/policies/${policyId}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });

    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error deleting policy:", error);
    return NextResponse.json(
      { error: "Failed to delete policy" },
      { status: 500 }
    );
  }
}
