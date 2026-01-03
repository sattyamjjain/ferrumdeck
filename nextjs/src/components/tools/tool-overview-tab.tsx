"use client";

import Link from "next/link";
import {
  Shield,
  AlertTriangle,
  DollarSign,
  Clock,
  Users,
  CheckCircle,
  XCircle,
  HelpCircle,
  Bot,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatCost, formatTimeAgo } from "@/lib/utils";
import type { ToolDetail, ToolRiskLevel, ToolDefaultPolicy } from "@/types/tool";

// Risk level explanations
const riskExplanations: Record<ToolRiskLevel, { title: string; description: string; icon: typeof Shield }> = {
  low: {
    title: "Low Risk",
    description: "Read-only operations. No data modification possible. Safe for autonomous execution.",
    icon: Shield,
  },
  medium: {
    title: "Medium Risk",
    description: "Can create or modify non-critical data. May require periodic review of actions.",
    icon: AlertTriangle,
  },
  high: {
    title: "High Risk",
    description: "Can modify important data or configurations. Should be monitored and may require approval for sensitive operations.",
    icon: AlertTriangle,
  },
  critical: {
    title: "Critical Risk",
    description: "Can perform destructive operations, access sensitive data, or make irreversible changes. Requires explicit approval for each use.",
    icon: AlertTriangle,
  },
};

// Policy badge config
const policyConfig: Record<ToolDefaultPolicy, { label: string; className: string; icon: typeof CheckCircle }> = {
  allowed: {
    label: "Allowed",
    className: "bg-accent-green/15 text-accent-green border-accent-green/30",
    icon: CheckCircle,
  },
  denied: {
    label: "Denied",
    className: "bg-accent-red/15 text-accent-red border-accent-red/30",
    icon: XCircle,
  },
  approval_required: {
    label: "Approval Required",
    className: "bg-accent-yellow/15 text-accent-yellow border-accent-yellow/30",
    icon: HelpCircle,
  },
};

interface ToolOverviewTabProps {
  tool: ToolDetail;
}

export function ToolOverviewTab({ tool }: ToolOverviewTabProps) {
  const riskInfo = riskExplanations[tool.risk_level] || riskExplanations.low;
  const RiskIcon = riskInfo.icon;
  const defaultPolicy = tool.policy?.default_policy || "denied";
  const policyInfo = policyConfig[defaultPolicy];
  const PolicyIcon = policyInfo.icon;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left Column */}
      <div className="space-y-6">
        {/* Description Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {tool.description || "No description provided."}
            </p>
          </CardContent>
        </Card>

        {/* Risk Level Card */}
        <Card className={cn(
          "border",
          tool.risk_level === "critical" && "border-accent-red/30",
          tool.risk_level === "high" && "border-accent-orange/30"
        )}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <RiskIcon className={cn(
                "h-5 w-5",
                tool.risk_level === "low" && "text-accent-green",
                tool.risk_level === "medium" && "text-accent-yellow",
                tool.risk_level === "high" && "text-accent-orange",
                tool.risk_level === "critical" && "text-accent-red"
              )} />
              <CardTitle className="text-sm">{riskInfo.title}</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{riskInfo.description}</p>
          </CardContent>
        </Card>

        {/* Default Policy Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Default Policy</CardTitle>
            <CardDescription>
              How this tool is treated when no specific agent override exists
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <PolicyIcon className={cn("h-5 w-5", policyInfo.className.split(" ")[1])} />
              <Badge variant="outline" className={cn("text-sm", policyInfo.className)}>
                {policyInfo.label}
              </Badge>
            </div>

            {tool.policy?.requires_justification && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-accent-yellow/10 border border-accent-yellow/20">
                <AlertTriangle className="h-4 w-4 text-accent-yellow mt-0.5" />
                <span className="text-sm text-accent-yellow">
                  Requires justification for each use
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Budget Constraints */}
        {(tool.policy?.budget_limit_cents || tool.policy?.rate_limit_per_minute) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Budget Constraints</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {tool.policy.budget_limit_cents && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-background-secondary">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Budget Limit</span>
                  </div>
                  <span className="text-sm font-medium">
                    {formatCost(tool.policy.budget_limit_cents)} per run
                  </span>
                </div>
              )}
              {tool.policy.rate_limit_per_minute && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-background-secondary">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Rate Limit</span>
                  </div>
                  <span className="text-sm font-medium">
                    {tool.policy.rate_limit_per_minute} calls/minute
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Right Column */}
      <div className="space-y-6">
        {/* Quick Stats */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Quick Stats</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-background-secondary">
                <div className="flex items-center gap-2 mb-1">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Used By</span>
                </div>
                <span className="text-2xl font-semibold">{tool.used_by_count}</span>
                <span className="text-sm text-muted-foreground ml-1">agents</span>
              </div>
              <div className="p-4 rounded-lg bg-background-secondary">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Last Called</span>
                </div>
                <span className="text-lg font-medium">
                  {tool.last_called ? formatTimeAgo(tool.last_called) : "Never"}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Schema Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Current Schema</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Version</span>
              <span className="text-sm font-mono">{tool.schema_version || "1.0.0"}</span>
            </div>
            {tool.latest_version && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Last Updated</span>
                  <span className="text-sm">{formatTimeAgo(tool.latest_version.created_at)}</span>
                </div>
                {tool.latest_version.created_by && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Updated By</span>
                    <span className="text-sm">{tool.latest_version.created_by}</span>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Agents Using This Tool */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Agents Using This Tool</CardTitle>
            <CardDescription>
              {tool.agents?.length || 0} agents have access to this tool
            </CardDescription>
          </CardHeader>
          <CardContent>
            {tool.agents && tool.agents.length > 0 ? (
              <div className="space-y-2">
                {tool.agents.slice(0, 5).map((agent) => (
                  <Link
                    key={agent.id}
                    href={`/agents/${agent.id}`}
                    className="flex items-center justify-between p-3 rounded-lg bg-background-secondary hover:bg-background-tertiary transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-accent-purple/10">
                        <Bot className="h-4 w-4 text-accent-purple" />
                      </div>
                      <div>
                        <p className="text-sm font-medium group-hover:text-accent-blue transition-colors">
                          {agent.name}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono">{agent.slug}</p>
                      </div>
                    </div>
                    <ExternalLink className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>
                ))}
                {tool.agents.length > 5 && (
                  <Link
                    href="/agents"
                    className="block text-center text-sm text-accent-blue hover:underline py-2"
                  >
                    View all {tool.agents.length} agents
                  </Link>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-sm text-muted-foreground">
                <Bot className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No agents are using this tool yet</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Allowed Scopes */}
        {tool.policy?.allowed_scopes && tool.policy.allowed_scopes.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Allowed Scopes</CardTitle>
              <CardDescription>
                Permissions this tool can operate with
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {tool.policy.allowed_scopes.map((scope) => (
                  <Badge key={scope} variant="outline" className="font-mono text-xs">
                    {scope}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
