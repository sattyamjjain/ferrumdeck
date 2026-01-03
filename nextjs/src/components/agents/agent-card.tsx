"use client";

import { Bot, Clock, Wrench, Play, CheckCircle, Settings, Layers, Eye } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatTimeAgo } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { Agent, AgentStatus } from "@/types/agent";

const statusConfig: Record<AgentStatus, { label: string; className: string; dotClass: string }> = {
  draft: {
    label: "Draft",
    className: "bg-secondary text-secondary-foreground",
    dotClass: "bg-accent-yellow",
  },
  active: {
    label: "Active",
    className: "bg-green-500/20 text-green-400",
    dotClass: "bg-accent-green",
  },
  deprecated: {
    label: "Deprecated",
    className: "bg-yellow-500/20 text-yellow-400",
    dotClass: "bg-accent-orange",
  },
  archived: {
    label: "Archived",
    className: "bg-secondary text-secondary-foreground",
    dotClass: "bg-muted-foreground",
  },
};

interface AgentCardProps {
  agent: Agent;
}

export function AgentCard({ agent }: AgentCardProps) {
  const status = statusConfig[agent.status] || statusConfig.draft;
  const version = agent.latest_version;

  // Calculate tool counts
  const allowedTools = version?.allowed_tools || [];
  const approvalTools = version?.approval_tools || [];
  const totalTools = allowedTools.length + approvalTools.length;
  const displayTools = [...allowedTools, ...approvalTools].slice(0, 3);
  const remainingTools = totalTools - displayTools.length;

  // Mock stats for display - these would come from useAgentStats in a real implementation
  // Using deterministic values based on agent id to avoid React purity issues
  const mockStats = {
    runs24h: (agent.id.charCodeAt(0) % 50) + 10,
    successRate: 85 + (agent.id.charCodeAt(1) % 15),
    lastRun: agent.updated_at,
  };

  return (
    <Card className="hover:bg-card/80 transition-all duration-200 cursor-pointer h-full group border-border/50 hover:border-border">
      <Link href={`/agents/${agent.id}`} className="block">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="p-2.5 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 group-hover:border-indigo-500/50 transition-colors">
                  <Bot className="h-5 w-5 text-indigo-400" />
                </div>
                <div
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card",
                    status.dotClass
                  )}
                />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-base truncate">{agent.name}</CardTitle>
                <p className="text-xs text-muted-foreground font-mono truncate">{agent.slug}</p>
              </div>
            </div>
            <Badge variant="secondary" className={cn("text-xs shrink-0", status.className)}>
              {status.label}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Description */}
          {agent.description && (
            <p className="text-sm text-muted-foreground line-clamp-2">{agent.description}</p>
          )}

          {/* Version badges */}
          {version && (
            <div className="flex flex-wrap gap-2">
              {/* Production version indicator */}
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-accent-green/10 border border-accent-green/30">
                <CheckCircle className="h-3 w-3 text-accent-green" />
                <span className="text-xs font-medium text-accent-green">
                  v{version.version}
                </span>
              </div>
              {/* Model badge */}
              {version.model && (
                <Badge variant="outline" className="text-xs font-mono">
                  {version.model}
                </Badge>
              )}
            </div>
          )}

          {/* Tools summary */}
          {totalTools > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Wrench className="h-3 w-3 text-muted-foreground" />
              {displayTools.map((tool) => (
                <Badge
                  key={tool}
                  variant="secondary"
                  className="text-xs px-1.5 py-0 h-5 bg-background-tertiary"
                >
                  {tool}
                </Badge>
              ))}
              {remainingTools > 0 && (
                <span className="text-xs text-muted-foreground">+{remainingTools} more</span>
              )}
            </div>
          )}

          {/* Stats row */}
          <div className="flex items-center justify-between pt-2 border-t border-border/30">
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatTimeAgo(mockStats.lastRun)}
              </span>
              <span className="flex items-center gap-1">
                <Play className="h-3 w-3" />
                {mockStats.runs24h} runs
              </span>
              <span className="flex items-center gap-1 text-accent-green">
                <CheckCircle className="h-3 w-3" />
                {mockStats.successRate}%
              </span>
            </div>
          </div>
        </CardContent>
      </Link>

      {/* Action buttons - visible on hover */}
      <div className="px-4 pb-4 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <Link href={`/agents/${agent.id}`} className="flex-1">
          <Button variant="outline" size="sm" className="w-full gap-1.5 text-xs h-8">
            <Eye className="h-3 w-3" />
            View
          </Button>
        </Link>
        <Link href={`/agents/${agent.id}?tab=versions`}>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8">
            <Layers className="h-3 w-3" />
            Versions
          </Button>
        </Link>
        <Link href={`/agents/${agent.id}?tab=tools`}>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8">
            <Settings className="h-3 w-3" />
            Tools
          </Button>
        </Link>
      </div>
    </Card>
  );
}
