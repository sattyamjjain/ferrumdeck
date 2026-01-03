"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Play,
  CheckCircle,
  DollarSign,
  TrendingUp,
  Layers,
  Wrench,
  Settings,
  FileText,
  ChevronRight,
  Rocket,
  RotateCcw,
  Shield,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import { cn, formatCost, formatDateTime } from "@/lib/utils";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/shared/loading-spinner";
import { useAgent, useAgentStats, useAgentVersions } from "@/hooks/use-agents";
import { AgentVersions } from "@/components/agents/agent-versions";
import { AgentTools } from "@/components/agents/agent-tools";
import { PromoteDialog } from "@/components/agents/promote-dialog";
import type { AgentVersion } from "@/types/agent";

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

function KpiCard({
  icon: Icon,
  label,
  value,
  subtitle,
  trend,
}: {
  icon: typeof DollarSign;
  label: string;
  value: string | number;
  subtitle?: string;
  trend?: { value: number; isPositive: boolean };
}) {
  return (
    <Card className="bg-card/50 border-border/50">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
            {trend && (
              <div
                className={cn(
                  "flex items-center gap-1 text-xs mt-1",
                  trend.isPositive ? "text-accent-green" : "text-accent-red"
                )}
              >
                <TrendingUp
                  className={cn("h-3 w-3", !trend.isPositive && "rotate-180")}
                />
                {Math.abs(trend.value)}% vs last period
              </div>
            )}
          </div>
          <div className="p-3 rounded-lg bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-fade-in">
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-lg" />
    </div>
  );
}

export default function AgentDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const agentId = params.agentId as string;

  // Get tab from URL or default to overview
  const initialTab = searchParams.get("tab") || "overview";
  const [activeTab, setActiveTab] = useState(initialTab);

  // Update tab when URL changes
  useEffect(() => {
    const tabFromUrl = searchParams.get("tab");
    if (tabFromUrl) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTab(tabFromUrl);
    }
  }, [searchParams]);

  const { data: agent, isLoading, error } = useAgent(agentId);
  const { data: stats } = useAgentStats(agentId);
  const { data: versions } = useAgentVersions(agentId);

  // State for promote dialog
  const [promoteDialogOpen, setPromoteDialogOpen] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<AgentVersion | null>(null);

  const handlePromote = (version: AgentVersion) => {
    setSelectedVersion(version);
    setPromoteDialogOpen(true);
  };

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

  // Mock stats if not loaded
  const displayStats = stats || {
    runs_24h: 42,
    success_rate: 0.94,
    avg_cost_cents: 156,
    last_run_at: agent.updated_at,
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/agents" className="hover:text-foreground transition-colors">
          Agents
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground">{agent.name}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          {/* Agent icon */}
          <div className="relative">
            <div className="h-16 w-16 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center">
              <Bot className="h-8 w-8 text-indigo-400" />
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
                  "font-medium capitalize",
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
                    <Layers className="h-3.5 w-3.5" />
                    v{version.version}
                  </span>
                </>
              )}
            </div>
            {agent.description && (
              <p className="text-sm text-muted-foreground max-w-2xl mt-2">{agent.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link href={`/runs?agent=${agent.slug}`}>
            <Button variant="outline" size="sm" className="gap-2">
              <Play className="h-4 w-4" />
              View Runs
            </Button>
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-background-secondary border border-border/30">
          <TabsTrigger value="overview" className="gap-2">
            <FileText className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="versions" className="gap-2">
            <Layers className="h-4 w-4" />
            Versions
          </TabsTrigger>
          <TabsTrigger value="tools" className="gap-2">
            <Wrench className="h-4 w-4" />
            Tools
          </TabsTrigger>
          <TabsTrigger value="runs" className="gap-2">
            <Play className="h-4 w-4" />
            Runs
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <Settings className="h-4 w-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <KpiCard
              icon={Play}
              label="Runs (24h)"
              value={displayStats.runs_24h}
              trend={{ value: 12, isPositive: true }}
            />
            <KpiCard
              icon={CheckCircle}
              label="Success Rate"
              value={`${Math.round(displayStats.success_rate * 100)}%`}
              subtitle="Last 7 days"
              trend={{ value: 3, isPositive: true }}
            />
            <KpiCard
              icon={DollarSign}
              label="Avg Cost"
              value={formatCost(displayStats.avg_cost_cents)}
              subtitle="Per run"
            />
          </div>

          {/* Active Versions */}
          <Card className="bg-card/50 border-border/50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-background-secondary flex items-center justify-center">
                    <Rocket className="h-5 w-5 text-accent-purple" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Active Versions</CardTitle>
                    <CardDescription className="text-xs mt-0.5">
                      Currently deployed versions by environment
                    </CardDescription>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border border-border/30 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-background-secondary/50 hover:bg-background-secondary/50">
                      <TableHead className="text-xs uppercase tracking-wider font-medium">
                        Environment
                      </TableHead>
                      <TableHead className="text-xs uppercase tracking-wider font-medium">
                        Version
                      </TableHead>
                      <TableHead className="text-xs uppercase tracking-wider font-medium">
                        Deployed
                      </TableHead>
                      <TableHead className="text-xs uppercase tracking-wider font-medium text-right">
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {version ? (
                      <>
                        <TableRow className="hover:bg-background-secondary/30">
                          <TableCell>
                            <Badge
                              variant="outline"
                              className="bg-accent-green/10 text-accent-green border-accent-green/30"
                            >
                              Production
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-sm">v{version.version}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatDateTime(version.created_at)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" className="gap-1.5 text-xs h-7">
                              <RotateCcw className="h-3 w-3" />
                              Rollback
                            </Button>
                          </TableCell>
                        </TableRow>
                        <TableRow className="hover:bg-background-secondary/30">
                          <TableCell>
                            <Badge
                              variant="outline"
                              className="bg-accent-yellow/10 text-accent-yellow border-accent-yellow/30"
                            >
                              Staging
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-sm">v{version.version}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatDateTime(version.created_at)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1.5 text-xs h-7"
                              onClick={() => handlePromote(version)}
                            >
                              <Rocket className="h-3 w-3" />
                              Promote
                            </Button>
                          </TableCell>
                        </TableRow>
                      </>
                    ) : (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8">
                          <p className="text-muted-foreground text-sm">No versions deployed</p>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Allowed Tools */}
          {version && (
            <Card className="bg-card/50 border-border/50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-background-secondary flex items-center justify-center">
                      <Wrench className="h-5 w-5 text-accent-cyan" />
                    </div>
                    <div>
                      <CardTitle className="text-base">Allowed Tools</CardTitle>
                      <CardDescription className="text-xs mt-0.5">
                        Tools available to this agent
                      </CardDescription>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => setActiveTab("tools")}
                  >
                    <Settings className="h-3 w-3" />
                    Edit Tools
                  </Button>
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
        </TabsContent>

        {/* Versions Tab */}
        <TabsContent value="versions">
          <AgentVersions
            versions={versions || (version ? [version] : [])}
            onPromote={handlePromote}
          />
        </TabsContent>

        {/* Tools Tab */}
        <TabsContent value="tools">
          <AgentTools agentId={agentId} version={version} />
        </TabsContent>

        {/* Runs Tab */}
        <TabsContent value="runs">
          <Card className="bg-card/50 border-border/50">
            <CardContent className="py-12">
              <EmptyState
                icon={Play}
                title="View Agent Runs"
                description="View all runs executed by this agent"
                variant="compact"
                actionLabel="Go to Runs"
                onAction={() => (window.location.href = `/runs?agent=${agent.slug}`)}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings">
          <Card className="bg-card/50 border-border/50">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-background-secondary flex items-center justify-center">
                  <Settings className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <CardTitle className="text-base">Agent Settings</CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    Configure agent metadata and behavior
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-sm">
                <div className="space-y-1.5">
                  <p className="text-muted-foreground text-xs uppercase tracking-wider">Agent ID</p>
                  <code className="font-mono text-xs bg-background-secondary px-2 py-1 rounded block truncate">
                    {agent.id}
                  </code>
                </div>
                <div className="space-y-1.5">
                  <p className="text-muted-foreground text-xs uppercase tracking-wider">
                    Project ID
                  </p>
                  <code className="font-mono text-xs bg-background-secondary px-2 py-1 rounded block truncate">
                    {agent.project_id || "N/A"}
                  </code>
                </div>
                <div className="space-y-1.5">
                  <p className="text-muted-foreground text-xs uppercase tracking-wider">Created</p>
                  <p className="text-foreground">{formatDateTime(agent.created_at)}</p>
                </div>
                <div className="space-y-1.5">
                  <p className="text-muted-foreground text-xs uppercase tracking-wider">Updated</p>
                  <p className="text-foreground">{formatDateTime(agent.updated_at)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Promote Dialog */}
      {selectedVersion && (
        <PromoteDialog
          open={promoteDialogOpen}
          onOpenChange={setPromoteDialogOpen}
          agentId={agentId}
          version={selectedVersion}
        />
      )}
    </div>
  );
}
