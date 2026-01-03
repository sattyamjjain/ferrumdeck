import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders, getDefaultProjectId } from "@/lib/api/config";
import type { Policy, PolicyRule, PolicyAction, PolicyStatus } from "@/types/policy";

// Gateway returns PolicyRule format, but frontend expects Policy format
// This function transforms gateway PolicyRules into frontend Policies
interface GatewayPolicyRule {
  id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  priority: number;
  conditions: Record<string, unknown>;
  effect: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

function transformPolicyRuleToPolicy(rule: GatewayPolicyRule): Policy {
  // Map gateway effect to frontend action
  const effectToAction: Record<string, PolicyAction> = {
    allow: "allow",
    deny: "deny",
    require_approval: "require_approval",
  };

  // Map enabled to status
  const status: PolicyStatus = rule.enabled ? "active" : "inactive";

  // Create a single rule from the conditions
  const policyRule: PolicyRule = {
    id: `${rule.id}_rule`,
    action: effectToAction[rule.effect] || "deny",
    condition: JSON.stringify(rule.conditions),
    description: rule.description || undefined,
    order: 1,
  };

  return {
    id: rule.id,
    project_id: rule.project_id || getDefaultProjectId(),
    name: rule.name,
    slug: rule.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    description: rule.description || undefined,
    priority: rule.priority,
    status,
    rules: [policyRule],
    created_at: rule.created_at,
    updated_at: rule.updated_at,
    created_by: rule.created_by || undefined,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Add default project_id if not provided
    if (!searchParams.has("project_id")) {
      searchParams.set("project_id", getDefaultProjectId());
    }

    const response = await fetch(`${getGatewayUrl()}/v1/policies?${searchParams}`, {
      headers: getAuthHeaders(),
    });

    const data: GatewayPolicyRule[] = await response.json();

    // Transform gateway PolicyRules to frontend Policies
    const policies: Policy[] = data.map(transformPolicyRuleToPolicy);

    return NextResponse.json(policies, { status: response.status });
  } catch (error) {
    console.error("Error fetching policies:", error);
    return NextResponse.json(
      { error: "Failed to fetch policies" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch(`${getGatewayUrl()}/v1/policies`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error creating policy:", error);
    return NextResponse.json(
      { error: "Failed to create policy" },
      { status: 500 }
    );
  }
}
