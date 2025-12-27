"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  Bot,
  Clock,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Wrench,
  Cpu,
  DollarSign,
  Zap,
  Hash,
  FileText,
  Calendar,
  Layers,
  Copy,
  Check,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton, SkeletonLine } from "@/components/shared/loading-spinner";
import type { Agent } from "@/types/agent";
import { useState } from "react";

async function fetchAgent(agentId: string): Promise<Agent> {
  const response = await fetch(`/api/v1/registry/agents/${agentId}`);
  if (!response.ok) {
    throw new Error("Failed to fetch agent");
  }
  return response.json();
}

function getStatusStyles(status: string): { bg: string; text: string; border: string } {
  switch (status) {
    case "active":
      return {
        bg: "bg-accent-green/10",
        text: "text-accent-green",
        border: "border-accent-green/30",
      };
    case "draft":
      return {
        bg: "bg-accent-yellow/10",
        text: "text-accent-yellow",
        border: "border-accent-yellow/30",
      };
    case "deprecated":
    case "archived":
      return {
        bg: "bg-accent-red/10",
        text: "text-accent-red",
        border: "border-accent-red/30",
      };
    default:
      return {
        bg: "bg-muted/50",
        text: "text-muted-foreground",
        border: "border-border/50",
      };
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded hover:bg-background-tertiary transition-colors"
      title="Copy to clipboard"
    >
      {copied ? (
        <Check className="h-3 w-3 text-accent-green" />
      ) : (
        <Copy className="h-3 w-3 text-muted-foreground" />
      )}
    </button>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  color = "text-foreground",
}: {
  icon: typeof DollarSign;
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div className="p-4 rounded-lg bg-background-secondary border border-border/30 space-y-2">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <p className={cn("text-2xl font-semibold tracking-tight", color)}>{value}</p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header skeleton */}
      <div className="flex items-center gap-4">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <div className="flex items-center gap-4">
          <Skeleton className="h-14 w-14 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
      </div>

      {/* Cards skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>

      <Skeleton className="h-64 rounded-lg" />
      <Skeleton className="h-48 rounded-lg" />
    </div>
  );
}

export default function AgentDetailPage() {
  const params = useParams();
  const agentId = params.agentId as string;

  const { data: agent, isLoading, error } = useQuery({
    queryKey: ["agent", agentId],
    queryFn: () => fetchAgent(agentId),
    enabled: !!agentId,
  });

  if (isLoading) {
    return (
      <div className="p-6">
        <LoadingSkeleton />
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="p-6 space-y-6">
        <Link href="/agents">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Agents
          </Button>
        </Link>
        <EmptyState
          icon={Bot}
          title="Agent Not Found"
          description="The agent you're looking for doesn't exist or couldn't be loaded."
          variant="card"
          actionLabel="View All Agents"
          onAction={() => (window.location.href = "/agents")}
        />
      </div>
    );
  }

  const version = agent.latest_version;
  const statusStyles = getStatusStyles(agent.status);

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link href="/agents">
          <Button
            variant="ghost"
            size="icon"
            className="mt-1 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>

        <div className="flex-1 flex items-start justify-between">
          <div className="flex items-center gap-4">
            {/* Agent icon */}
            <div className="relative">
              <div className="h-16 w-16 rounded-xl bg-gradient-to-br from-accent-blue/20 to-accent-purple/20 border border-border/50 flex items-center justify-center">
                <Bot className="h-8 w-8 text-accent-blue" />
              </div>
              <div
                className={cn(
                  "absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-background",
                  agent.status === "active" ? "bg-accent-green" : "bg-muted-foreground"
                )}
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold tracking-tight">{agent.name}</h1>
                <Badge
                  variant="outline"
                  className={cn(
                    "font-medium",
                    statusStyles.bg,
                    statusStyles.text,
                    statusStyles.border
                  )}
                >
                  {agent.status}
                </Badge>
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span className="font-mono">{agent.slug}</span>
                {version && (
                  <>
                    <span className="text-border">|</span>
                    <span className="flex items-center gap-1">
                      <Layers className="h-3.5 w-3.5" />v{version.version}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-2">
              <FileText className="h-4 w-4" />
              View Runs
            </Button>
          </div>
        </div>
      </div>

      {/* Description */}
      {agent.description && (
        <Card className="bg-card/50 border-border/50">
          <CardContent className="pt-6">
            <p className="text-muted-foreground leading-relaxed">{agent.description}</p>
          </CardContent>
        </Card>
      )}

      {/* Budget metrics */}
      {version?.budget && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {version.budget.max_input_tokens && (
            <MetricCard
              icon={Zap}
              label="Max Input"
              value={version.budget.max_input_tokens.toLocaleString()}
              color="text-accent-blue"
            />
          )}
          {version.budget.max_output_tokens && (
            <MetricCard
              icon={Zap}
              label="Max Output"
              value={version.budget.max_output_tokens.toLocaleString()}
              color="text-accent-cyan"
            />
          )}
          {version.budget.max_tool_calls && (
            <MetricCard
              icon={Hash}
              label="Max Tools"
              value={version.budget.max_tool_calls}
              color="text-accent-purple"
            />
          )}
          {version.budget.max_cost_cents && (
            <MetricCard
              icon={DollarSign}
              label="Max Cost"
              value={`$${(version.budget.max_cost_cents / 100).toFixed(2)}`}
              color="text-accent-green"
            />
          )}
        </div>
      )}

      {/* Version Info */}
      {version && (
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-background-secondary flex items-center justify-center">
                  <Cpu className="h-5 w-5 text-accent-blue" />
                </div>
                <div>
                  <CardTitle className="text-base">Model Configuration</CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    Version {version.version} settings
                  </CardDescription>
                </div>
              </div>
              <Badge variant="outline" className="font-mono text-xs">
                {version.model}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs uppercase tracking-wider">Version ID</p>
                <div className="flex items-center gap-2">
                  <code className="font-mono text-xs bg-background-secondary px-2 py-1 rounded">
                    {version.id}
                  </code>
                  <CopyButton text={version.id} />
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs uppercase tracking-wider">Created</p>
                <p className="flex items-center gap-2 text-foreground">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  {new Date(version.created_at).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tool Permissions */}
      {version && (
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-background-secondary flex items-center justify-center">
                <Wrench className="h-5 w-5 text-accent-purple" />
              </div>
              <div>
                <CardTitle className="text-base">Tool Permissions</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Configured tool access levels
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-border/30 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-background-secondary/50 hover:bg-background-secondary/50">
                    <TableHead className="text-xs uppercase tracking-wider font-medium">
                      Tool Name
                    </TableHead>
                    <TableHead className="text-xs uppercase tracking-wider font-medium">
                      Permission
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {version.allowed_tools?.map((tool) => (
                    <TableRow key={tool} className="hover:bg-background-secondary/30">
                      <TableCell className="font-mono text-sm">{tool}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="bg-accent-green/10 text-accent-green border-accent-green/30 gap-1.5"
                        >
                          <ShieldCheck className="h-3 w-3" />
                          Allowed
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {version.approval_tools?.map((tool) => (
                    <TableRow key={tool} className="hover:bg-background-secondary/30">
                      <TableCell className="font-mono text-sm">{tool}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="bg-accent-yellow/10 text-accent-yellow border-accent-yellow/30 gap-1.5"
                        >
                          <Shield className="h-3 w-3" />
                          Requires Approval
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {version.denied_tools?.map((tool) => (
                    <TableRow key={tool} className="hover:bg-background-secondary/30">
                      <TableCell className="font-mono text-sm">{tool}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="bg-accent-red/10 text-accent-red border-accent-red/30 gap-1.5"
                        >
                          <ShieldAlert className="h-3 w-3" />
                          Denied
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!version.allowed_tools?.length &&
                    !version.approval_tools?.length &&
                    !version.denied_tools?.length && (
                      <TableRow>
                        <TableCell colSpan={2} className="text-center py-8">
                          <p className="text-muted-foreground text-sm">
                            No tool permissions configured
                          </p>
                        </TableCell>
                      </TableRow>
                    )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* System Prompt */}
      {version?.system_prompt && (
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-background-secondary flex items-center justify-center">
                  <FileText className="h-5 w-5 text-accent-cyan" />
                </div>
                <div>
                  <CardTitle className="text-base">System Prompt</CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    Agent instructions and behavior
                  </CardDescription>
                </div>
              </div>
              <CopyButton text={version.system_prompt} />
            </div>
          </CardHeader>
          <CardContent>
            <pre className="p-4 rounded-lg bg-background-secondary border border-border/30 text-sm text-muted-foreground whitespace-pre-wrap font-mono overflow-x-auto leading-relaxed">
              {version.system_prompt}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Metadata */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-background-secondary flex items-center justify-center">
              <Clock className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <CardTitle className="text-base">Metadata</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Agent identification and timestamps
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-sm">
            <div className="space-y-1.5">
              <p className="text-muted-foreground text-xs uppercase tracking-wider">Agent ID</p>
              <div className="flex items-center gap-2">
                <code className="font-mono text-xs bg-background-secondary px-2 py-1 rounded truncate max-w-[120px]">
                  {agent.id}
                </code>
                <CopyButton text={agent.id} />
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-muted-foreground text-xs uppercase tracking-wider">Project ID</p>
              <div className="flex items-center gap-2">
                <code className="font-mono text-xs bg-background-secondary px-2 py-1 rounded truncate max-w-[120px]">
                  {agent.project_id || "N/A"}
                </code>
                {agent.project_id && <CopyButton text={agent.project_id} />}
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-muted-foreground text-xs uppercase tracking-wider">Created</p>
              <p className="text-foreground">
                {new Date(agent.created_at).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </p>
            </div>
            {agent.updated_at && (
              <div className="space-y-1.5">
                <p className="text-muted-foreground text-xs uppercase tracking-wider">Updated</p>
                <p className="text-foreground">
                  {new Date(agent.updated_at).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
