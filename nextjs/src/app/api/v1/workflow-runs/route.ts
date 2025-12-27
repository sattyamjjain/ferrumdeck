import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders, getDefaultProjectId } from "@/lib/api/config";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Add default project_id if not provided
    if (!searchParams.has("project_id")) {
      searchParams.set("project_id", getDefaultProjectId());
    }

    const response = await fetch(`${getGatewayUrl()}/v1/workflow-runs?${searchParams}`, {
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      // Return empty array if endpoint not available
      console.warn(`Workflow runs endpoint returned ${response.status}, returning empty array`);
      return NextResponse.json({ runs: [], total: 0 });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching workflow runs:", error);
    // Return empty array on connection error
    return NextResponse.json({ runs: [], total: 0 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch(`${getGatewayUrl()}/v1/workflow-runs`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error creating workflow run:", error);
    return NextResponse.json(
      { error: "Failed to create workflow run" },
      { status: 500 }
    );
  }
}
