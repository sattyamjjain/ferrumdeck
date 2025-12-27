import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders, getDefaultProjectId } from "@/lib/api/config";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Add default project_id if not provided
    if (!searchParams.has("project_id")) {
      searchParams.set("project_id", getDefaultProjectId());
    }

    const response = await fetch(`${getGatewayUrl()}/v1/workflows?${searchParams}`, {
      headers: getAuthHeaders(),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error fetching workflows:", error);
    return NextResponse.json(
      { error: "Failed to fetch workflows" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Add default project_id if not provided
    if (!body.project_id) {
      body.project_id = getDefaultProjectId();
    }

    const response = await fetch(`${getGatewayUrl()}/v1/workflows`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error creating workflow:", error);
    return NextResponse.json(
      { error: "Failed to create workflow" },
      { status: 500 }
    );
  }
}
