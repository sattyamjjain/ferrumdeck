"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  GitBranch,
  ChevronRight,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Play,
  Settings,
  Trash2,
  ArrowLeft,
  Layers,
  FileJson,
  Activity,
  RefreshCw,
  Edit,
} from "lucide-react";
import { useWorkflow, useWorkflowRuns, getStepTypeInfo, getRunStatusInfo } from "@/hooks/use-workflows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { JsonViewer } from "@/components/shared/json-viewer";
import { cn } from "@/lib/utils";

// Status configuration
const statusConfig: Record<string, { label: string; className: string; icon: typeof CheckCircle }> = {
  active: {
    label: "Active",
    className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    icon: CheckCircle,
  },
  draft: {
    label: "Draft",
    className: "bg-slate-500/15 text-slate-400 border-slate-500/30",
    icon: Edit,
  },
  deprecated: {
    label: "Deprecated",
    className: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    icon: AlertCircle,
  },
  archived: {
    label: "Archived",
    className: "bg-red-500/15 text-red-400 border-red-500/30",
    icon: XCircle,
  },
};

interface WorkflowDetailProps {
  workflowId: string;
}

export function WorkflowDetail({ workflowId }: WorkflowDetailProps) {
  const router = useRouter();
  const { data: workflow, isLoading, error, refetch } = useWorkflow(workflowId);
  const { data: runsData, isLoading: runsLoading } = useWorkflowRuns(workflowId);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/v1/workflows/${workflowId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        router.push("/workflows");
      }
    } catch (error) {
      console.error("Failed to delete workflow:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return <LoadingPage />;
  }

  if (error || !workflow) {
    return (
      <EmptyState
        icon={GitBranch}
        title="Workflow not found"
        description="The workflow you're looking for doesn't exist or has been deleted."
        actionLabel="Back to Workflows"
        onAction={() => router.push("/workflows")}
      />
    );
  }

  const status = statusConfig[workflow.status] || statusConfig.draft;
  const StatusIcon = status.icon;
  const runs = runsData?.runs ?? [];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Breadcrumb */}
      <nav className="flex items-center text-sm text-muted-foreground">
        <Link href="/workflows" className="hover:text-foreground transition-colors flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" />
          Workflows
        </Link>
        <ChevronRight className="h-4 w-4 mx-2" />
        <span className="text-foreground font-medium">{workflow.name}</span>
      </nav>

      {/* Header */}
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/5 via-transparent to-transparent rounded-xl -z-10" />
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
              <GitBranch className="h-6 w-6 text-cyan-400" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold tracking-tight">{workflow.name}</h1>
                <Badge variant="outline" className={cn("text-xs font-medium border gap-1.5", status.className)}>
                  <StatusIcon className="h-3 w-3" />
                  {status.label}
                </Badge>
                <Badge variant="outline" className="font-mono text-xs bg-slate-800/50">
                  v{workflow.version}
                </Badge>
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Layers className="h-4 w-4" />
                  <span>{workflow.steps?.length || 0} steps</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <code className="text-xs bg-slate-800/50 px-1.5 py-0.5 rounded font-mono">
                    {workflow.slug}
                  </code>
                </div>
                {workflow.updated_at && (
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-4 w-4" />
                    <span>Updated {formatRelativeTime(workflow.updated_at)}</span>
                  </div>
                )}
              </div>
              {workflow.description && (
                <p className="text-sm text-muted-foreground max-w-2xl">{workflow.description}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
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
              Edit
            </Button>
            <Button className="bg-cyan-600 hover:bg-cyan-700 gap-2">
              <Play className="h-4 w-4" />
              Run Workflow
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="steps">Steps</TabsTrigger>
          <TabsTrigger value="schema">Schema</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="mt-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Quick Stats */}
            <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-700/50">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Activity className="h-5 w-5 text-cyan-400" />
                  Quick Stats
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Total Runs</span>
                  <span className="font-semibold">{runs.length}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Success Rate</span>
                  <span className="font-semibold text-emerald-400">
                    {runs.length > 0
                      ? Math.round((runs.filter((r) => r.status === "completed").length / runs.length) * 100)
                      : 0}%
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Active Runs</span>
                  <span className="font-semibold text-blue-400">
                    {runs.filter((r) => r.status === "running" || r.status === "waiting_approval").length}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Failed Runs</span>
                  <span className="font-semibold text-red-400">
                    {runs.filter((r) => r.status === "failed").length}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Workflow Info */}
            <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-700/50">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileJson className="h-5 w-5 text-purple-400" />
                  Workflow Info
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">ID</span>
                  <code className="text-xs bg-slate-800/50 px-2 py-1 rounded font-mono">
                    {workflow.id}
                  </code>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Project</span>
                  <code className="text-xs bg-slate-800/50 px-2 py-1 rounded font-mono">
                    {workflow.project_id}
                  </code>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Created</span>
                  <span className="text-sm">{formatDate(workflow.created_at)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Updated</span>
                  <span className="text-sm">{formatDate(workflow.updated_at)}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Steps Tab */}
        <TabsContent value="steps" className="mt-6">
          <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-700/50">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Layers className="h-5 w-5 text-cyan-400" />
                Workflow Steps
              </CardTitle>
              <CardDescription>
                {workflow.steps?.length || 0} steps in this workflow
              </CardDescription>
            </CardHeader>
            <CardContent>
              {workflow.steps && workflow.steps.length > 0 ? (
                <div className="space-y-4">
                  {workflow.steps.map((step, index) => {
                    const typeInfo = getStepTypeInfo(step.type);
                    return (
                      <div
                        key={step.id}
                        className="flex items-start gap-4 p-4 rounded-lg border border-slate-700/50 bg-slate-800/30 hover:bg-slate-800/50 transition-colors"
                      >
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-700/50 text-sm font-medium">
                          {index + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium">{step.name}</span>
                            <Badge variant="outline" className={cn("text-xs", typeInfo.color)}>
                              {typeInfo.label}
                            </Badge>
                          </div>
                          {step.depends_on && step.depends_on.length > 0 && (
                            <div className="text-xs text-muted-foreground">
                              Depends on: {step.depends_on.join(", ")}
                            </div>
                          )}
                          {step.config && Object.keys(step.config).length > 0 && (
                            <div className="mt-2">
                              <JsonViewer data={step.config} collapsed={true} maxHeight={150} />
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          {step.timeout_secs && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {step.timeout_secs}s
                            </span>
                          )}
                          {step.retry_count && step.retry_count > 0 && (
                            <span className="flex items-center gap-1">
                              <RefreshCw className="h-3 w-3" />
                              {step.retry_count} retries
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  icon={Layers}
                  title="No steps defined"
                  description="This workflow doesn't have any steps configured yet."
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Schema Tab */}
        <TabsContent value="schema" className="mt-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-700/50">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileJson className="h-5 w-5 text-emerald-400" />
                  Input Schema
                </CardTitle>
                <CardDescription>
                  JSON Schema for workflow input validation
                </CardDescription>
              </CardHeader>
              <CardContent>
                {workflow.input_schema ? (
                  <JsonViewer data={workflow.input_schema} collapsed={false} />
                ) : (
                  <div className="text-sm text-muted-foreground text-center py-8">
                    No input schema defined
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-700/50">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileJson className="h-5 w-5 text-blue-400" />
                  Output Schema
                </CardTitle>
                <CardDescription>
                  JSON Schema for workflow output validation
                </CardDescription>
              </CardHeader>
              <CardContent>
                {workflow.output_schema ? (
                  <JsonViewer data={workflow.output_schema} collapsed={false} />
                ) : (
                  <div className="text-sm text-muted-foreground text-center py-8">
                    No output schema defined
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Runs Tab */}
        <TabsContent value="runs" className="mt-6">
          <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-700/50">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="h-5 w-5 text-blue-400" />
                Recent Runs
              </CardTitle>
              <CardDescription>
                {runsLoading ? "Loading..." : `${runs.length} runs`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {runsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : runs.length > 0 ? (
                <div className="space-y-3">
                  {runs.slice(0, 10).map((run) => {
                    const statusInfo = getRunStatusInfo(run.status);
                    return (
                      <Link
                        key={run.id}
                        href={`/runs/${run.id}`}
                        className="flex items-center justify-between p-4 rounded-lg border border-slate-700/50 bg-slate-800/30 hover:bg-slate-800/50 transition-colors"
                      >
                        <div className="flex items-center gap-4">
                          <Badge variant="outline" className={cn("text-xs", statusInfo.color)}>
                            {statusInfo.label}
                          </Badge>
                          <code className="text-xs font-mono text-muted-foreground">
                            {run.id.slice(0, 16)}...
                          </code>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span>
                            {run.completed_steps}/{run.total_steps} steps
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            {formatRelativeTime(run.created_at)}
                          </span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  icon={Activity}
                  title="No runs yet"
                  description="This workflow hasn't been executed yet."
                  action={
                    <Button className="bg-cyan-600 hover:bg-cyan-700 gap-2">
                      <Play className="h-4 w-4" />
                      Run Workflow
                    </Button>
                  }
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Workflow</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{workflow.name}&quot;? This action cannot be undone.
              {runs.length > 0 && (
                <span className="block mt-2 text-amber-400">
                  Warning: This workflow has {runs.length} run(s) associated with it.
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
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Helper functions
function formatDate(dateString?: string): string {
  if (!dateString) return "—";
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelativeTime(dateString?: string): string {
  if (!dateString) return "—";
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(dateString);
}
