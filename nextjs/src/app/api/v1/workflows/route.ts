import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders, getDefaultProjectId } from "@/lib/api/config";

// Helper to transform workflow from backend to frontend schema
function transformWorkflow(workflow: Record<string, unknown>): Record<string, unknown> {
  const definition = workflow.definition as Record<string, unknown> | undefined;
  return {
    ...workflow,
    slug: definition?.slug || "",
    steps: definition?.steps || [],
    input_schema: definition?.input_schema,
  };
}

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

    // Transform each workflow to frontend schema
    if (data.workflows && Array.isArray(data.workflows)) {
      data.workflows = data.workflows.map(transformWorkflow);
    }

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

    // Transform frontend schema to backend schema
    // Frontend sends: { name, slug, description, steps, version?, input_schema? }
    // Backend expects: { name, description, version, definition, project_id, max_iterations?, on_error? }
    const gatewayBody = {
      name: body.name,
      description: body.description,
      version: body.version || "1.0.0",
      definition: {
        steps: body.steps || [],
        input_schema: body.input_schema,
        slug: body.slug,
      },
      project_id: body.project_id || getDefaultProjectId(),
      max_iterations: body.max_iterations || 10,
      on_error: body.on_error || "fail",
    };

    const response = await fetch(`${getGatewayUrl()}/v1/workflows`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(gatewayBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gateway error:", errorText);
      return NextResponse.json(
        { error: "Failed to create workflow", details: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Transform response back to frontend schema
    const frontendResponse = {
      ...data,
      slug: data.definition?.slug || body.slug,
      steps: data.definition?.steps || [],
      input_schema: data.definition?.input_schema,
    };

    return NextResponse.json(frontendResponse, { status: response.status });
  } catch (error) {
    console.error("Error creating workflow:", error);
    return NextResponse.json(
      { error: "Failed to create workflow" },
      { status: 500 }
    );
  }
}
