import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders } from "@/lib/api/config";

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId } = await params;

    const response = await fetch(`${getGatewayUrl()}/v1/workflows/${workflowId}`, {
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gateway error:", errorText);
      return NextResponse.json(
        { error: "Failed to fetch workflow" },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Transform to frontend schema
    const transformedWorkflow = transformWorkflow(data);

    return NextResponse.json(transformedWorkflow, { status: response.status });
  } catch (error) {
    console.error("Error fetching workflow:", error);
    return NextResponse.json(
      { error: "Failed to fetch workflow" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId } = await params;
    const body = await request.json();

    // Transform frontend schema to backend schema
    const gatewayBody = {
      name: body.name,
      description: body.description,
      version: body.version,
      definition: {
        steps: body.steps || [],
        input_schema: body.input_schema,
        slug: body.slug,
      },
      max_iterations: body.max_iterations,
      on_error: body.on_error,
    };

    const response = await fetch(`${getGatewayUrl()}/v1/workflows/${workflowId}`, {
      method: "PUT",
      headers: getAuthHeaders(),
      body: JSON.stringify(gatewayBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gateway error:", errorText);
      return NextResponse.json(
        { error: "Failed to update workflow" },
        { status: response.status }
      );
    }

    const data = await response.json();
    const transformedWorkflow = transformWorkflow(data);

    return NextResponse.json(transformedWorkflow, { status: response.status });
  } catch (error) {
    console.error("Error updating workflow:", error);
    return NextResponse.json(
      { error: "Failed to update workflow" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId } = await params;

    const response = await fetch(`${getGatewayUrl()}/v1/workflows/${workflowId}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gateway error:", errorText);
      return NextResponse.json(
        { error: "Failed to delete workflow" },
        { status: response.status }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error deleting workflow:", error);
    return NextResponse.json(
      { error: "Failed to delete workflow" },
      { status: 500 }
    );
  }
}
