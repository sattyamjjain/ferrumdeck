"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Wrench,
  ChevronRight,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Server,
  Shield,
  Settings,
  Trash2,
} from "lucide-react";
import { useTool, useDeleteTool } from "@/hooks/use-tools";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LoadingPage } from "@/components/shared/loading-spinner";
import { EmptyState } from "@/components/shared/empty-state";
import { ToolOverviewTab } from "./tool-overview-tab";
import { ToolSchemaTab } from "./tool-schema-tab";
import { ToolVersionsTab } from "./tool-versions-tab";
import { ToolUsageTab } from "./tool-usage-tab";
import { ToolPolicyTab } from "./tool-policy-tab";
import { cn } from "@/lib/utils";
import type { ToolRiskLevel, ToolHealthStatus } from "@/types/tool";

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
    label: "SLOW",
    icon: Clock,
    className: "text-accent-yellow",
  },
  error: {
    label: "ERROR",
    icon: XCircle,
    className: "text-accent-red",
  },
  unknown: {
    label: "Unknown",
    icon: AlertCircle,
    className: "text-muted-foreground",
  },
};

interface ToolDetailProps {
  toolId: string;
  initialTab?: string;
}

export function ToolDetail({ toolId, initialTab }: ToolDetailProps) {
  const router = useRouter();
  const { data: tool, isLoading, error } = useTool(toolId);
  const deleteMutation = useDeleteTool();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleDelete = async () => {
    await deleteMutation.mutateAsync(toolId);
    router.push("/tools");
  };

  if (isLoading) {
    return <LoadingPage />;
  }

  if (error || !tool) {
    return (
      <EmptyState
        icon={Wrench}
        title="Tool not found"
        description="The tool you're looking for doesn't exist or has been deleted."
        actionLabel="Back to Tools"
        onAction={() => router.push("/tools")}
      />
    );
  }

  const risk = riskConfig[tool.risk_level] || riskConfig.low;
  const health = healthConfig[tool.health_status] || healthConfig.unknown;
  const HealthIcon = health.icon;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Breadcrumb */}
      <nav className="flex items-center text-sm text-muted-foreground">
        <Link href="/tools" className="hover:text-foreground transition-colors">
          Tools
        </Link>
        <ChevronRight className="h-4 w-4 mx-2" />
        <span className="text-foreground font-medium">{tool.name}</span>
      </nav>

      {/* Header */}
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-accent-cyan/5 via-transparent to-transparent rounded-xl -z-10" />
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-accent-cyan/10 border border-accent-cyan/20">
              <Wrench className="h-6 w-6 text-accent-cyan" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold tracking-tight">{tool.name}</h1>
                <Badge variant="outline" className={cn("text-xs font-medium border", risk.className)}>
                  {risk.label}
                </Badge>
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Server className="h-4 w-4" />
                  <span className="font-mono">{tool.mcp_server}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <HealthIcon className={cn("h-4 w-4", health.className)} />
                  <span className={health.className}>{health.label}</span>
                </div>
                {tool.schema_version && (
                  <div className="flex items-center gap-1.5">
                    <Shield className="h-4 w-4" />
                    <span className="font-mono">v{tool.schema_version}</span>
                  </div>
                )}
              </div>
              {tool.description && (
                <p className="text-sm text-muted-foreground max-w-2xl">{tool.description}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => setShowDeleteDialog(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
            <Button variant="outline" size="sm">
              <Settings className="h-4 w-4 mr-2" />
              Configure
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue={initialTab || "overview"} className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="schema">Schema</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
          <TabsTrigger value="policy">Policy</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <ToolOverviewTab tool={tool} />
        </TabsContent>

        <TabsContent value="schema" className="mt-6">
          <ToolSchemaTab toolId={toolId} tool={tool} />
        </TabsContent>

        <TabsContent value="versions" className="mt-6">
          <ToolVersionsTab toolId={toolId} />
        </TabsContent>

        <TabsContent value="usage" className="mt-6">
          <ToolUsageTab toolId={toolId} />
        </TabsContent>

        <TabsContent value="policy" className="mt-6">
          <ToolPolicyTab toolId={toolId} tool={tool} />
        </TabsContent>
      </Tabs>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Tool</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{tool.name}&quot;? This action cannot be undone.
              {tool.used_by_count > 0 && (
                <span className="block mt-2 text-accent-yellow">
                  Warning: This tool is currently used by {tool.used_by_count} agent(s).
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
