import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders, getDefaultProjectId } from "@/lib/api/config";

// Gateway returns objects with metadata, frontend expects string[]
interface GatewayMcpServer {
  name: string;
  tool_count: number;
  status: string;
  first_seen: string;
  last_seen: string;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Add default project_id if not provided
    if (!searchParams.has("project_id")) {
      searchParams.set("project_id", getDefaultProjectId());
    }

    const response = await fetch(`${getGatewayUrl()}/v1/registry/mcp-servers?${searchParams}`, {
      headers: getAuthHeaders(),
    });

    const data: GatewayMcpServer[] = await response.json();

    // Transform to string[] - frontend expects just server names
    const serverNames: string[] = data.map((server) => server.name);

    return NextResponse.json(serverNames, { status: response.status });
  } catch (error) {
    console.error("Error fetching MCP servers:", error);
    return NextResponse.json(
      { error: "Failed to fetch MCP servers" },
      { status: 500 }
    );
  }
}
