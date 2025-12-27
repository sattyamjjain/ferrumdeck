"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  GitBranch,
  Plus,
  Search,
  RefreshCw,
  AlertCircle,
  Play,
  Clock,
  Activity,
  CheckCircle,
  XCircle,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { LoadingSpinner, SkeletonRow } from "@/components/shared/loading-spinner";
import { EmptyState } from "@/components/shared/empty-state";
import {
  useWorkflows,
  useWorkflowRuns,
  useCreateWorkflow,
  getRunStatusInfo,
  type Workflow,
  type WorkflowRun,
} from "@/hooks/use-workflows";

function formatDate(dateString: string): string {
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

function getStatusBadgeStyle(status: string): string {
  switch (status) {
    case "active":
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    case "draft":
      return "bg-slate-500/10 text-slate-400 border-slate-500/20";
    case "deprecated":
      return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    case "archived":
      return "bg-red-500/10 text-red-400 border-red-500/20";
    default:
      return "bg-slate-500/10 text-slate-400 border-slate-500/20";
  }
}

export default function WorkflowsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const { data: workflowsData, isLoading: workflowsLoading, error: workflowsError, refetch: refetchWorkflows } = useWorkflows();
  const { data: runsData } = useWorkflowRuns();
  const createMutation = useCreateWorkflow();

  const workflows = workflowsData?.workflows || [];

  // Filter workflows by search
  const filteredWorkflows = useMemo(() => {
    if (!searchQuery) return workflows;
    const query = searchQuery.toLowerCase();
    return workflows.filter(
      (w) =>
        w.name.toLowerCase().includes(query) ||
        w.slug.toLowerCase().includes(query) ||
        w.description?.toLowerCase().includes(query)
    );
  }, [workflows, searchQuery]);

  // Stats
  const stats = useMemo(() => {
    const runs = runsData?.runs || [];
    return {
      total: workflows.length,
      active: workflows.filter((w) => w.status === "active").length,
      recentRuns: runs.length,
      runningRuns: runs.filter((r) => r.status === "running" || r.status === "waiting_approval").length,
    };
  }, [workflows, runsData?.runs]);

  const handleCreate = async () => {
    if (!newName.trim() || !newSlug.trim()) {
      toast.error("Name and slug are required");
      return;
    }

    try {
      await createMutation.mutateAsync({
        name: newName.trim(),
        slug: newSlug.trim(),
        description: newDescription.trim() || undefined,
        steps: [],
      });
      setIsCreateOpen(false);
      setNewName("");
      setNewSlug("");
      setNewDescription("");
    } catch (err) {
      // Error handled by mutation
    }
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Page header with gradient accent */}
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-accent-cyan/5 via-transparent to-transparent rounded-xl -z-10" />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 pb-2">
            <div className="p-2.5 rounded-xl bg-accent-cyan/10 border border-accent-cyan/20">
              <GitBranch className="h-5 w-5 text-accent-cyan" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Workflows</h1>
              <p className="text-sm text-muted-foreground">
                Create and manage multi-step agentic workflows
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchWorkflows()}
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2 bg-cyan-600 hover:bg-cyan-700">
                  <Plus className="h-4 w-4" />
                  New Workflow
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <GitBranch className="h-5 w-5 text-cyan-400" />
                    Create Workflow
                  </DialogTitle>
                  <DialogDescription>
                    Create a new workflow to orchestrate multi-step agentic tasks.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input
                      placeholder="e.g., Document Processing"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="bg-slate-900/50 border-slate-700"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Slug</Label>
                    <Input
                      placeholder="e.g., document-processing"
                      value={newSlug}
                      onChange={(e) => setNewSlug(e.target.value)}
                      className="bg-slate-900/50 border-slate-700 font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Textarea
                      placeholder="Describe the workflow purpose..."
                      value={newDescription}
                      onChange={(e) => setNewDescription(e.target.value)}
                      className="bg-slate-900/50 border-slate-700"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreate}
                    disabled={createMutation.isPending}
                    className="bg-cyan-600 hover:bg-cyan-700"
                  >
                    {createMutation.isPending ? <LoadingSpinner size="sm" /> : "Create"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-700/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-cyan-500/10">
                <GitBranch className="h-5 w-5 text-cyan-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Workflows</p>
                <p className="text-2xl font-semibold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-700/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <CheckCircle className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Active</p>
                <p className="text-2xl font-semibold">{stats.active}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-700/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Activity className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Recent Runs</p>
                <p className="text-2xl font-semibold">{stats.recentRuns}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-700/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <Play className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Running</p>
                <p className="text-2xl font-semibold">{stats.runningRuns}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-700/50">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search workflows..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-slate-900/50 border-slate-700"
            />
          </div>
        </CardContent>
      </Card>

      {/* Workflows Table */}
      <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-700/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-cyan-400" />
            <CardTitle>Workflows</CardTitle>
          </div>
          <CardDescription>
            {workflowsLoading ? "Loading..." : `${filteredWorkflows.length} workflows`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {workflowsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <SkeletonRow key={i} />
              ))}
            </div>
          ) : workflowsError ? (
            <EmptyState
              icon={AlertCircle}
              title="Failed to load workflows"
              description="There was an error fetching workflows."
              action={
                <Button onClick={() => refetchWorkflows()} variant="outline">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry
                </Button>
              }
            />
          ) : filteredWorkflows.length === 0 ? (
            <EmptyState
              icon={GitBranch}
              title="No workflows yet"
              description={
                searchQuery
                  ? "No workflows match your search."
                  : "Create your first workflow to orchestrate multi-step tasks."
              }
              action={
                !searchQuery && (
                  <Button
                    onClick={() => setIsCreateOpen(true)}
                    className="bg-cyan-600 hover:bg-cyan-700"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Create Workflow
                  </Button>
                )
              }
            />
          ) : (
            <div className="rounded-lg border border-slate-700/50 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-slate-700/50">
                    <TableHead className="text-slate-400">Name</TableHead>
                    <TableHead className="text-slate-400">Slug</TableHead>
                    <TableHead className="text-slate-400">Version</TableHead>
                    <TableHead className="text-slate-400">Steps</TableHead>
                    <TableHead className="text-slate-400">Status</TableHead>
                    <TableHead className="text-slate-400">Updated</TableHead>
                    <TableHead className="text-right text-slate-400">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredWorkflows.map((workflow, index) => (
                    <TableRow
                      key={workflow.id}
                      className="hover:bg-slate-800/50 border-slate-700/50 animate-fade-in"
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <TableCell className="font-medium">
                        <div>
                          <p>{workflow.name}</p>
                          {workflow.description && (
                            <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                              {workflow.description}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <code className="text-sm text-slate-400 bg-slate-800/50 px-1.5 py-0.5 rounded">
                          {workflow.slug}
                        </code>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono bg-slate-800/50">
                          v{workflow.version}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-muted-foreground">
                          {workflow.steps.length} steps
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={getStatusBadgeStyle(workflow.status)}>
                          {workflow.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5" />
                          {formatRelativeTime(workflow.updated_at)}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/workflows/${workflow.id}`}>
                          <Button variant="ghost" size="sm" className="gap-1">
                            View
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
