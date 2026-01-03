"use client";

import Link from "next/link";
import {
  Activity,
  Bot,
  Clock,
  ExternalLink,
  AlertCircle,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToolUsageStats, useToolCalls } from "@/hooks/use-tools";
import { ToolUsageChart, UsageStatsCards } from "./tool-usage-stats";
import { LoadingPage, SkeletonTableRow, Skeleton } from "@/components/shared/loading-spinner";
import { EmptyState, EmptyRow } from "@/components/shared/empty-state";
import { cn, formatTimeAgo, formatNumber, truncateId } from "@/lib/utils";

interface ToolUsageTabProps {
  toolId: string;
}

export function ToolUsageTab({ toolId }: ToolUsageTabProps) {
  const { data: stats, isLoading: statsLoading } = useToolUsageStats(toolId);
  const { data: calls, isLoading: callsLoading } = useToolCalls(toolId, 20);

  if (statsLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-8 w-20 mb-2" />
                <Skeleton className="h-4 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="py-8">
            <Skeleton className="h-[300px] w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!stats) {
    return (
      <EmptyState
        icon={Activity}
        title="No usage data available"
        description="Usage statistics will appear here once the tool has been called."
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <UsageStatsCards stats={stats} />

      {/* Usage Chart */}
      {stats.calls_by_day && stats.calls_by_day.length > 0 && (
        <ToolUsageChart data={stats.calls_by_day} />
      )}

      {/* Top Agents */}
      {stats.top_agents && stats.top_agents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Top Agents</CardTitle>
            <CardDescription>Agents using this tool most frequently</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats.top_agents.map((agent, index) => (
                <Link
                  key={agent.agent_id}
                  href={`/agents/${agent.agent_id}`}
                  className="flex items-center justify-between p-3 rounded-lg bg-background-secondary hover:bg-background-tertiary transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-6 h-6 rounded-full bg-accent-purple/10 text-accent-purple text-xs font-medium">
                      {index + 1}
                    </div>
                    <div className="p-2 rounded-lg bg-accent-purple/10">
                      <Bot className="h-4 w-4 text-accent-purple" />
                    </div>
                    <div>
                      <p className="text-sm font-medium group-hover:text-accent-blue transition-colors">
                        {agent.agent_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Last called {formatTimeAgo(agent.last_called)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium">{formatNumber(agent.call_count)} calls</span>
                    <ExternalLink className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Calls Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent Calls</CardTitle>
          <CardDescription>Latest tool invocations</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[80px]">Status</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead className="w-[150px]">Run</TableHead>
                <TableHead className="w-[100px]">Latency</TableHead>
                <TableHead className="w-[140px]">Called</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {callsLoading ? (
                <>
                  <SkeletonTableRow columns={5} />
                  <SkeletonTableRow columns={5} />
                  <SkeletonTableRow columns={5} />
                </>
              ) : !calls || calls.length === 0 ? (
                <EmptyRow colSpan={5} message="No recent calls" />
              ) : (
                calls.map((call) => (
                  <TableRow key={call.id}>
                    <TableCell>
                      {call.error ? (
                        <div className="flex items-center gap-1.5 text-accent-red">
                          <XCircle className="h-4 w-4" />
                          <span className="text-xs">Error</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-accent-green">
                          <CheckCircle className="h-4 w-4" />
                          <span className="text-xs">OK</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/agents/${call.agent_id}`}
                        className="text-sm hover:text-accent-blue transition-colors"
                      >
                        {call.agent_name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/runs/${call.run_id}`}
                        className="text-sm font-mono text-muted-foreground hover:text-accent-blue transition-colors"
                      >
                        {truncateId(call.run_id, 12)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className={cn(
                        "text-sm",
                        call.latency_ms > 1000 && "text-accent-yellow",
                        call.latency_ms > 5000 && "text-accent-red"
                      )}>
                        {call.latency_ms}ms
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        {formatTimeAgo(call.called_at)}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
