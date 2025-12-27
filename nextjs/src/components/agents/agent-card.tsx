"use client";

import { Bot, Clock, Tag, Wrench } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatTimeAgo } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { Agent, AgentStatus } from "@/types/agent";

const statusConfig: Record<AgentStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-secondary text-secondary-foreground" },
  active: { label: "Active", className: "bg-green-500/20 text-green-400" },
  deprecated: { label: "Deprecated", className: "bg-yellow-500/20 text-yellow-400" },
  archived: { label: "Archived", className: "bg-secondary text-secondary-foreground" },
};

interface AgentCardProps {
  agent: Agent;
}

export function AgentCard({ agent }: AgentCardProps) {
  const status = statusConfig[agent.status] || statusConfig.draft;
  const version = agent.latest_version;

  return (
    <Link href={`/agents/${agent.id}`}>
      <Card className="hover:bg-card/80 transition-colors cursor-pointer h-full">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-primary/10">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">{agent.name}</CardTitle>
                <p className="text-xs text-muted-foreground font-mono">{agent.slug}</p>
              </div>
            </div>
            <Badge variant="secondary" className={cn("text-xs", status.className)}>
              {status.label}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {agent.description && (
            <p className="text-sm text-muted-foreground line-clamp-2">
              {agent.description}
            </p>
          )}

          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatTimeAgo(agent.created_at)}
            </span>
            {version && (
              <>
                <span className="flex items-center gap-1">
                  <Tag className="h-3 w-3" />
                  v{version.version}
                </span>
                <span className="flex items-center gap-1">
                  <Wrench className="h-3 w-3" />
                  {(version.allowed_tools?.length || 0) + (version.approval_tools?.length || 0)} tools
                </span>
              </>
            )}
          </div>

          {version?.model && (
            <Badge variant="outline" className="text-xs">
              {version.model}
            </Badge>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
