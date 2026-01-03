"use client";

import Link from "next/link";
import {
  Wrench,
  Clock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Users,
  Server,
  ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatTimeAgo } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { Tool, ToolRiskLevel, ToolHealthStatus, ToolStatus } from "@/types/tool";

// Risk level configuration
const riskConfig: Record<ToolRiskLevel, { label: string; className: string }> = {
  low: {
    label: "LOW",
    className: "bg-accent-green/15 text-accent-green border-accent-green/30",
  },
  medium: {
    label: "MEDIUM",
    className: "bg-accent-yellow/15 text-accent-yellow border-accent-yellow/30",
  },
  high: {
    label: "HIGH",
    className: "bg-accent-orange/15 text-accent-orange border-accent-orange/30",
  },
  critical: {
    label: "CRITICAL",
    className: "bg-accent-red/15 text-accent-red border-accent-red/30",
  },
};

// Health status configuration
const healthConfig: Record<ToolHealthStatus, { label: string; icon: typeof CheckCircle; className: string }> = {
  ok: {
    label: "OK",
    icon: CheckCircle,
    className: "text-accent-green",
  },
  slow: {
    label: "Slow",
    icon: Clock,
    className: "text-accent-yellow",
  },
  error: {
    label: "Error",
    icon: XCircle,
    className: "text-accent-red",
  },
  unknown: {
    label: "Unknown",
    icon: AlertTriangle,
    className: "text-muted-foreground",
  },
};

// Status configuration
const statusConfig: Record<ToolStatus, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-accent-green/15 text-accent-green" },
  deprecated: { label: "Deprecated", className: "bg-accent-yellow/15 text-accent-yellow" },
  disabled: { label: "Disabled", className: "bg-secondary text-secondary-foreground" },
};

interface ToolCardProps {
  tool: Tool;
}

export function ToolCard({ tool }: ToolCardProps) {
  const risk = riskConfig[tool.risk_level] || riskConfig.low;
  const health = healthConfig[tool.health_status] || healthConfig.unknown;
  const status = statusConfig[tool.status] || statusConfig.active;
  const HealthIcon = health.icon;

  return (
    <Link href={`/tools/${tool.id}`}>
      <Card className="hover:bg-card/80 hover:border-border-hover transition-all h-full group cursor-pointer">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-accent-cyan/10 border border-accent-cyan/20">
                <Wrench className="h-4 w-4 text-accent-cyan" />
              </div>
              <div>
                <CardTitle className="text-base group-hover:text-accent-blue transition-colors">
                  {tool.name}
                </CardTitle>
                <p className="text-xs text-muted-foreground font-mono">{tool.slug}</p>
              </div>
            </div>
            <ExternalLink className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Status Badges */}
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className={cn("text-xs font-medium border", risk.className)}>
              {risk.label}
            </Badge>
            <Badge variant="secondary" className={cn("text-xs", status.className)}>
              {status.label}
            </Badge>
          </div>

          {tool.description && (
            <p className="text-sm text-muted-foreground line-clamp-2">
              {tool.description}
            </p>
          )}

          {/* Meta Info */}
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {/* MCP Server */}
            <div className="flex items-center gap-1">
              <Server className="h-3 w-3" />
              <span className="font-mono">{tool.mcp_server}</span>
            </div>

            {/* Health Status */}
            <div className="flex items-center gap-1">
              <HealthIcon className={cn("h-3 w-3", health.className)} />
              <span className={health.className}>{health.label}</span>
            </div>
          </div>

          {/* Usage Stats */}
          <div className="flex items-center justify-between pt-2 border-t border-border/50">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="h-3 w-3" />
              <span>{tool.used_by_count} agents</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>{tool.last_called ? formatTimeAgo(tool.last_called) : "Never called"}</span>
            </div>
          </div>

          {/* Warning for critical tools */}
          {tool.risk_level === "critical" && (
            <div className="flex items-center gap-1 text-xs text-accent-red">
              <AlertTriangle className="h-3 w-3" />
              Requires approval for execution
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
