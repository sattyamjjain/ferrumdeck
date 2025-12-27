"use client";

import { Wrench, Clock, AlertTriangle, Eye, Edit, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatTimeAgo } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { Tool, ToolRiskLevel, ToolStatus } from "@/types/tool";

const statusConfig: Record<ToolStatus, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-green-500/20 text-green-400" },
  deprecated: { label: "Deprecated", className: "bg-yellow-500/20 text-yellow-400" },
  disabled: { label: "Disabled", className: "bg-secondary text-secondary-foreground" },
};

const riskConfig: Record<ToolRiskLevel, { label: string; className: string; icon: typeof Eye }> = {
  read: { label: "Read", className: "bg-blue-500/20 text-blue-400", icon: Eye },
  write: { label: "Write", className: "bg-yellow-500/20 text-yellow-400", icon: Edit },
  destructive: { label: "Destructive", className: "bg-red-500/20 text-red-400", icon: Trash2 },
};

interface ToolCardProps {
  tool: Tool;
}

export function ToolCard({ tool }: ToolCardProps) {
  const status = statusConfig[tool.status] || statusConfig.active;
  const risk = riskConfig[tool.risk_level] || riskConfig.read;
  const RiskIcon = risk.icon;

  return (
    <Card className="hover:bg-card/80 transition-colors h-full">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <Wrench className="h-4 w-4 text-blue-400" />
            </div>
            <div>
              <CardTitle className="text-base">{tool.name}</CardTitle>
              <p className="text-xs text-muted-foreground font-mono">{tool.slug}</p>
            </div>
          </div>
          <div className="flex flex-col gap-1 items-end">
            <Badge variant="secondary" className={cn("text-xs", status.className)}>
              {status.label}
            </Badge>
            <Badge variant="secondary" className={cn("text-xs", risk.className)}>
              <RiskIcon className="h-3 w-3 mr-1" />
              {risk.label}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {tool.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {tool.description}
          </p>
        )}

        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatTimeAgo(tool.created_at)}
          </span>
          {tool.mcp_server && (
            <Badge variant="outline" className="text-xs font-mono">
              {tool.mcp_server}
            </Badge>
          )}
        </div>

        {tool.risk_level === "destructive" && (
          <div className="flex items-center gap-1 text-xs text-yellow-400">
            <AlertTriangle className="h-3 w-3" />
            Requires approval for execution
          </div>
        )}
      </CardContent>
    </Card>
  );
}
