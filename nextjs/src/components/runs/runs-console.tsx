"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Sparkles,
  MoreHorizontal,
  Eye,
  Ban,
  RefreshCw,
  Copy,
  Bot,
  Layers,
  Download,
  Filter,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

import { useRuns } from "@/hooks/use-runs";
import { useAgents } from "@/hooks/use-agents";
import { useIsMounted } from "@/hooks/use-is-mounted";
import { cancelRun } from "@/lib/api/runs";
import { RunStatusBadge } from "./run-status-badge";
import { CreateRunDialog } from "./create-run-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  formatTimeAgo,
  formatDateTime,
  formatDurationBetween,
  formatCost,
  truncateId,
  copyToClipboard,
  isRunActive,
} from "@/lib/utils";
import type { Run, RunStatus } from "@/types/run";

// Saved view configuration
interface SavedView {
  id: string;
  label: string;
  icon?: React.ReactNode;
  filter: {
    status?: RunStatus | "all";
    failedToday?: boolean;
    awaitingApproval?: boolean;
  };
}

const savedViews: SavedView[] = [
  { id: "all", label: "All Runs", filter: { status: "all" } },
  {
    id: "running",
    label: "Running",
    icon: <span className="h-1.5 w-1.5 rounded-full bg-accent-yellow animate-pulse" />,
    filter: { status: "running" },
  },
  {
    id: "failed-today",
    label: "Failed Today",
    icon: <span className="h-1.5 w-1.5 rounded-full bg-accent-red" />,
    filter: { failedToday: true },
  },
  {
    id: "awaiting",
    label: "Awaiting Approval",
    icon: <span className="h-1.5 w-1.5 rounded-full bg-accent-purple animate-pulse" />,
    filter: { awaitingApproval: true },
  },
];

const PAGE_SIZE = 25;

export function RunsConsole() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const tableRef = useRef<HTMLDivElement>(null);

  // Hydration fix - ensure client-only rendering for Radix components
  const mounted = useIsMounted();

  // Filter state
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<RunStatus | "all">("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [activeView, setActiveView] = useState("all");

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Pagination state (cursor-based simulation with offset)
  const [currentPage, setCurrentPage] = useState(0);

  // Keyboard navigation state
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  // Fetch runs with polling
  const { data, isLoading, error, refetch } = useRuns({
    limit: PAGE_SIZE,
    offset: currentPage * PAGE_SIZE,
    status: statusFilter !== "all" ? statusFilter : undefined,
  });

  // Fetch agents for filter dropdown
  const { data: agentsData } = useAgents();
  const agents = useMemo(() => agentsData ?? [], [agentsData]);

  const runs = useMemo(() => data?.runs ?? [], [data]);
  const totalRuns = data?.total ?? runs.length;

  // Calculate stats
  const stats = useMemo(() => {
    if (!data?.runs) return { total: 0, active: 0, failed: 0, completed: 0 };
    const allRuns = data.runs;
    return {
      total: totalRuns,
      active: allRuns.filter((r) => isRunActive(r.status)).length,
      failed: allRuns.filter((r) => r.status === "failed").length,
      completed: allRuns.filter((r) => r.status === "completed").length,
    };
  }, [data, totalRuns]);

  // Filter runs client-side
  const filteredRuns = useMemo(() => {
    return runs.filter((run) => {
      // Search filter
      if (search) {
        const searchLower = search.toLowerCase();
        const matchesId = run.id.toLowerCase().includes(searchLower);
        const matchesAgent = run.agent_id?.toLowerCase().includes(searchLower);
        const matchesInput = JSON.stringify(run.input).toLowerCase().includes(searchLower);
        if (!matchesId && !matchesAgent && !matchesInput) {
          return false;
        }
      }

      // Agent filter
      if (agentFilter !== "all" && run.agent_id !== agentFilter) {
        return false;
      }

      // Saved view filters
      const view = savedViews.find((v) => v.id === activeView);
      if (view?.filter.failedToday) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const runDate = new Date(run.created_at);
        if (run.status !== "failed" || runDate < today) {
          return false;
        }
      }
      if (view?.filter.awaitingApproval) {
        if (run.status !== "waiting_approval") {
          return false;
        }
      }

      return true;
    });
  }, [runs, search, agentFilter, activeView]);

  // Cancel run mutation
  const cancelMutation = useMutation({
    mutationFn: cancelRun,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      toast.success("Run cancelled");
    },
    onError: () => {
      toast.error("Failed to cancel run");
    },
  });

  // Bulk cancel mutation
  const bulkCancelMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => cancelRun(id)));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      setSelectedIds(new Set());
      toast.success("Selected runs cancelled");
    },
    onError: () => {
      toast.error("Failed to cancel some runs");
    },
  });

  // Handle view change
  const handleViewChange = useCallback((viewId: string) => {
    setActiveView(viewId);
    const view = savedViews.find((v) => v.id === viewId);
    if (view?.filter.status && view.filter.status !== "all") {
      setStatusFilter(view.filter.status);
    } else if (!view?.filter.failedToday && !view?.filter.awaitingApproval) {
      setStatusFilter("all");
    }
    setCurrentPage(0);
  }, []);

  // Selection handlers
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === filteredRuns.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredRuns.map((r) => r.id)));
    }
  }, [filteredRuns, selectedIds.size]);

  const isAllSelected = filteredRuns.length > 0 && selectedIds.size === filteredRuns.length;
  const isSomeSelected = selectedIds.size > 0 && selectedIds.size < filteredRuns.length;

  // Copy ID handler
  const handleCopyId = useCallback(async (id: string) => {
    const success = await copyToClipboard(id);
    if (success) {
      toast.success("Run ID copied to clipboard");
    } else {
      toast.error("Failed to copy");
    }
  }, []);

  // Export CSV handler
  const handleExportCSV = useCallback(() => {
    const runsToExport = selectedIds.size > 0
      ? filteredRuns.filter((r) => selectedIds.has(r.id))
      : filteredRuns;

    const headers = ["ID", "Agent", "Status", "Created", "Duration", "Cost", "Steps"];
    const rows = runsToExport.map((run) => [
      run.id,
      run.agent_id || "-",
      run.status,
      run.created_at,
      formatDurationBetween(run.started_at, run.completed_at),
      formatCost(run.cost_cents),
      run.tool_calls?.toString() || "0",
    ]);

    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `runs-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported");
  }, [filteredRuns, selectedIds]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if not in input
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      if (e.key === "j") {
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(prev + 1, filteredRuns.length - 1));
      } else if (e.key === "k") {
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && focusedIndex >= 0) {
        e.preventDefault();
        const run = filteredRuns[focusedIndex];
        if (run) {
          router.push(`/runs/${run.id}`);
        }
      } else if (e.key === "x" && focusedIndex >= 0) {
        e.preventDefault();
        const run = filteredRuns[focusedIndex];
        if (run) {
          toggleSelect(run.id);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filteredRuns, focusedIndex, router, toggleSelect]);

  // Pagination
  const totalPages = Math.ceil(totalRuns / PAGE_SIZE);
  const hasNextPage = currentPage < totalPages - 1;
  const hasPrevPage = currentPage > 0;

  // Clear filters
  const clearFilters = useCallback(() => {
    setSearch("");
    setStatusFilter("all");
    setAgentFilter("all");
    setActiveView("all");
    setCurrentPage(0);
  }, []);

  const hasActiveFilters = search || statusFilter !== "all" || agentFilter !== "all" || activeView !== "all";

  if (error) {
    return (
      <div className="space-y-6 animate-fade-in">
        <EmptyState
          icon={AlertCircle}
          title="Connection Error"
          description="Unable to fetch runs from the server. Please check your connection and try again."
          variant="card"
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full space-y-4 animate-fade-in">
      {/* Stats bar and actions */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background-secondary border border-border/50">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Total:</span>
            <span className="text-sm font-semibold tabular-nums">{stats.total}</span>
          </div>
          {stats.active > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent-yellow/10 border border-accent-yellow/20">
              <div className="status-dot status-dot-running" />
              <span className="text-sm font-medium text-accent-yellow tabular-nums">
                {stats.active} active
              </span>
            </div>
          )}
        </div>
        <CreateRunDialog />
      </div>

      {/* Saved views tabs */}
      <div className="flex items-center gap-1 p-1 rounded-lg bg-background-secondary border border-border/30 w-fit">
        {savedViews.map((view) => (
          <button
            key={view.id}
            onClick={() => handleViewChange(view.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
              activeView === view.id
                ? "bg-background-tertiary text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-background-tertiary/50"
            )}
          >
            {view.icon}
            {view.label}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search input */}
        <div className="relative flex-1 max-w-md group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-accent-blue" />
          <Input
            placeholder="Search by ID, agent, or task..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={cn(
              "pl-10 pr-10 h-9",
              "bg-background-secondary border-border/50",
              "placeholder:text-muted-foreground/50",
              "focus:border-accent-blue/50 focus:bg-background",
              "transition-all duration-200"
            )}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-sm text-muted-foreground hover:text-foreground hover:bg-background-tertiary transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Status filter */}
        {mounted && (
          <Select
            value={statusFilter}
            onValueChange={(v) => {
              setStatusFilter(v as RunStatus | "all");
              setActiveView("all");
            }}
          >
            <SelectTrigger className="w-[140px] h-9 bg-background-secondary border-border/50">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="running">Running</SelectItem>
              <SelectItem value="waiting_approval">Awaiting</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="timeout">Timeout</SelectItem>
            </SelectContent>
          </Select>
        )}

        {/* Agent filter */}
        {mounted && (
          <Select value={agentFilter} onValueChange={setAgentFilter}>
            <SelectTrigger className="w-[160px] h-9 bg-background-secondary border-border/50">
              <Bot className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
              <SelectValue placeholder="Agent" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Agents</SelectItem>
              {agents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.name || truncateId(agent.id, 12)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Clear filters */}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="h-9 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* Active filters indicator */}
      {hasActiveFilters && (
        <div className="flex items-center gap-2 text-xs animate-fade-in">
          <Filter className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">
            Showing {filteredRuns.length} of {totalRuns} runs
          </span>
        </div>
      )}

      {/* Bulk actions bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-accent-blue/10 border border-accent-blue/20 animate-scale-in">
          <span className="text-sm font-medium text-accent-blue">
            {selectedIds.size} selected
          </span>
          <div className="h-4 w-px bg-accent-blue/30" />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-accent-red hover:text-accent-red hover:bg-accent-red/10"
            onClick={() => {
              const activeIds = Array.from(selectedIds).filter((id) => {
                const run = filteredRuns.find((r) => r.id === id);
                return run && isRunActive(run.status);
              });
              if (activeIds.length > 0) {
                bulkCancelMutation.mutate(activeIds);
              } else {
                toast.error("No active runs selected");
              }
            }}
            disabled={bulkCancelMutation.isPending}
          >
            <Ban className="h-3 w-3 mr-1" />
            Cancel Selected
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={handleExportCSV}
          >
            <Download className="h-3 w-3 mr-1" />
            Export CSV
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground ml-auto"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear selection
          </Button>
        </div>
      )}

      {/* Data table */}
      <div
        ref={tableRef}
        className="flex-1 min-h-0 overflow-auto rounded-lg border border-border/50 bg-card/30"
      >
        {isLoading ? (
          <RunsTableSkeleton />
        ) : filteredRuns.length === 0 ? (
          <div className="flex items-center justify-center h-full min-h-[300px]">
            <EmptyState
              icon={search || hasActiveFilters ? Activity : Sparkles}
              title={search || hasActiveFilters ? "No matching runs" : "No runs yet"}
              description={
                search || hasActiveFilters
                  ? "Try adjusting your search or filters to find what you are looking for."
                  : "Create your first run to start orchestrating AI agents with confidence."
              }
              variant="compact"
              action={
                search || hasActiveFilters ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearFilters}
                    className="bg-background-secondary hover:bg-background-tertiary"
                  >
                    Clear filters
                  </Button>
                ) : (
                  <CreateRunDialog />
                )
              }
            />
          </div>
        ) : (
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background-secondary/95 backdrop-blur-sm">
              <TableRow className="hover:bg-transparent border-border/50">
                <TableHead className="w-10">
                  <Checkbox
                    checked={isAllSelected}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all"
                    className={cn(
                      isSomeSelected && "data-[state=checked]:bg-primary/50"
                    )}
                  />
                </TableHead>
                <TableHead className="w-[140px]">Run ID</TableHead>
                <TableHead className="w-[120px]">Agent</TableHead>
                <TableHead className="w-[100px]">Status</TableHead>
                <TableHead className="w-[120px]">Created</TableHead>
                <TableHead className="w-[90px]">Duration</TableHead>
                <TableHead className="w-[70px] text-right">Steps</TableHead>
                <TableHead className="w-[80px] text-right">Cost</TableHead>
                <TableHead className="w-[50px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRuns.map((run, index) => (
                <RunTableRow
                  key={run.id}
                  run={run}
                  isSelected={selectedIds.has(run.id)}
                  isFocused={index === focusedIndex}
                  onToggleSelect={() => toggleSelect(run.id)}
                  onCopyId={() => handleCopyId(run.id)}
                  onCancel={() => cancelMutation.mutate(run.id)}
                  isCancelling={cancelMutation.isPending}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2">
          <span className="text-xs text-muted-foreground">
            Page {currentPage + 1} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setCurrentPage((p) => p - 1)}
              disabled={!hasPrevPage}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setCurrentPage((p) => p + 1)}
              disabled={!hasNextPage}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <span className="text-xs text-muted-foreground">
            {filteredRuns.length} items
          </span>
        </div>
      )}

      {/* Keyboard shortcuts hint */}
      <div className="flex items-center justify-center gap-4 text-[10px] text-muted-foreground/60">
        <span>
          <kbd className="px-1 py-0.5 rounded bg-background-tertiary border border-border/30 font-mono">j</kbd>
          <kbd className="px-1 py-0.5 rounded bg-background-tertiary border border-border/30 font-mono ml-0.5">k</kbd>
          {" "}navigate
        </span>
        <span>
          <kbd className="px-1 py-0.5 rounded bg-background-tertiary border border-border/30 font-mono">Enter</kbd>
          {" "}open
        </span>
        <span>
          <kbd className="px-1 py-0.5 rounded bg-background-tertiary border border-border/30 font-mono">x</kbd>
          {" "}select
        </span>
      </div>
    </div>
  );
}

// Individual table row component
interface RunTableRowProps {
  run: Run;
  isSelected: boolean;
  isFocused: boolean;
  onToggleSelect: () => void;
  onCopyId: () => void;
  onCancel: () => void;
  isCancelling: boolean;
}

function RunTableRow({
  run,
  isSelected,
  isFocused,
  onToggleSelect,
  onCopyId,
  onCancel,
  isCancelling,
}: RunTableRowProps) {
  const canCancel = isRunActive(run.status);

  return (
    <TableRow
      className={cn(
        "group transition-all duration-200 cursor-pointer border-border/30",
        "hover:bg-gradient-to-r hover:from-accent-primary/5 hover:to-transparent",
        "hover:border-l-2 hover:border-l-accent-primary/50",
        isSelected && "bg-accent-blue/8 border-l-2 border-l-accent-blue",
        isFocused && "bg-accent-blue/10 ring-1 ring-accent-blue/30 ring-inset"
      )}
      data-state={isSelected ? "selected" : undefined}
    >
      <TableCell onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={isSelected}
          onCheckedChange={onToggleSelect}
          aria-label={`Select run ${run.id}`}
        />
      </TableCell>
      <TableCell>
        <Link
          href={`/runs/${run.id}`}
          className="font-mono text-xs text-accent-blue hover:underline"
        >
          {truncateId(run.id, 16)}
        </Link>
      </TableCell>
      <TableCell>
        {run.agent_id ? (
          <Link href={`/agents/${run.agent_id}`}>
            <Badge
              variant="outline"
              className="font-mono text-[10px] px-1.5 py-0 h-5 bg-background-tertiary/50 hover:bg-background-tertiary cursor-pointer"
            >
              <Bot className="h-2.5 w-2.5 mr-1" />
              {truncateId(run.agent_id, 8)}
            </Badge>
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        )}
      </TableCell>
      <TableCell>
        <RunStatusBadge status={run.status} size="sm" />
      </TableCell>
      <TableCell>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-xs text-muted-foreground cursor-help">
              {formatTimeAgo(run.created_at)}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {formatDateTime(run.created_at)}
          </TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell>
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatDurationBetween(run.started_at, run.completed_at)}
        </span>
      </TableCell>
      <TableCell className="text-right">
        <span className="text-xs text-muted-foreground tabular-nums">
          {run.tool_calls ?? 0}
        </span>
      </TableCell>
      <TableCell className="text-right">
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatCost(run.cost_cents)}
        </span>
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[160px]">
            <DropdownMenuItem asChild>
              <Link href={`/runs/${run.id}`}>
                <Eye className="h-4 w-4 mr-2" />
                View Details
              </Link>
            </DropdownMenuItem>
            {canCancel && (
              <DropdownMenuItem
                onClick={onCancel}
                disabled={isCancelling}
                className="text-accent-red focus:text-accent-red"
              >
                <Ban className="h-4 w-4 mr-2" />
                Cancel Run
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={`/runs/new?replay=${run.id}`}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Replay
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCopyId}>
              <Copy className="h-4 w-4 mr-2" />
              Copy ID
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

// Table skeleton for loading state
function RunsTableSkeleton() {
  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-background-secondary/95 backdrop-blur-sm">
        <TableRow className="hover:bg-transparent border-border/50">
          <TableHead className="w-10">
            <Skeleton className="h-4 w-4" />
          </TableHead>
          <TableHead className="w-[140px]">Run ID</TableHead>
          <TableHead className="w-[120px]">Agent</TableHead>
          <TableHead className="w-[100px]">Status</TableHead>
          <TableHead className="w-[120px]">Created</TableHead>
          <TableHead className="w-[90px]">Duration</TableHead>
          <TableHead className="w-[70px] text-right">Steps</TableHead>
          <TableHead className="w-[80px] text-right">Cost</TableHead>
          <TableHead className="w-[50px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: 10 }).map((_, i) => (
          <TableRow key={i} className="border-border/30">
            <TableCell>
              <Skeleton className="h-4 w-4" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-24" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-5 w-16" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-5 w-16" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-14" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-12" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-6 ml-auto" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-10 ml-auto" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-7 w-7" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
