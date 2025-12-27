import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders, getDefaultProjectId } from "@/lib/api/config";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Add default project_id if not provided
    if (!searchParams.has("project_id")) {
      searchParams.set("project_id", getDefaultProjectId());
    }

    const response = await fetch(`${getGatewayUrl()}/v1/audit?${searchParams}`, {
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      // Return empty array if endpoint not available
      console.warn(`Audit endpoint returned ${response.status}, returning empty array`);
      return NextResponse.json({ events: [], total: 0 });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching audit events:", error);
    // Return empty array on connection error
    return NextResponse.json({ events: [], total: 0 });
  }
}
