"use client";

import { useState, useMemo } from "react";
import { Activity, Sparkles } from "lucide-react";
import { useRuns } from "@/hooks/use-runs";
import { RunListItem, RunListItemSkeleton } from "./run-list-item";
import { RunFilters } from "./run-filters";
import { CreateRunDialog } from "./create-run-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import type { RunStatus } from "@/types/run";

export function RunList() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<RunStatus | "all">("all");

  const { data, isLoading, error } = useRuns();

  const runs = useMemo(() => data?.runs ?? [], [data]);

  const filteredRuns = useMemo(() => {
    return runs.filter((run) => {
      // Status filter
      if (statusFilter !== "all" && run.status !== statusFilter) {
        return false;
      }

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

      return true;
    });
  }, [runs, statusFilter, search]);

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="space-y-6">
        <RunFilters
          search={search}
          onSearchChange={setSearch}
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
        />
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <RunListItemSkeleton key={i} index={i} />
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="space-y-6">
        <RunFilters
          search={search}
          onSearchChange={setSearch}
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
        />
        <EmptyState
          icon={Activity}
          title="Connection Error"
          description="Unable to fetch runs from the server. Please check your connection and try again."
          variant="card"
          actionLabel="Retry"
          onAction={() => window.location.reload()}
        />
      </div>
    );
  }

  // Calculate stats for header
  const totalRuns = data?.runs?.length || 0;
  const activeRuns = data?.runs?.filter(r => r.status === "running" || r.status === "waiting_approval").length || 0;

  return (
    <div className="space-y-6">
      {/* Stats bar and actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background-secondary border border-border/50">
            <span className="text-sm text-muted-foreground">Total:</span>
            <span className="text-sm font-medium">{totalRuns}</span>
          </div>
          {activeRuns > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent-yellow/10 border border-accent-yellow/20">
              <div className="status-dot status-dot-running" />
              <span className="text-sm font-medium text-accent-yellow">{activeRuns} active</span>
            </div>
          )}
        </div>
        <CreateRunDialog />
      </div>

      {/* Filters */}
      <RunFilters
        search={search}
        onSearchChange={setSearch}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
      />

      {/* Results */}
      {filteredRuns.length === 0 ? (
        <EmptyState
          icon={search || statusFilter !== "all" ? Activity : Sparkles}
          title={search || statusFilter !== "all" ? "No matching runs" : "No runs yet"}
          description={
            search || statusFilter !== "all"
              ? "Try adjusting your search or filters to find what you're looking for."
              : "Create your first run to start orchestrating AI agents with confidence."
          }
          variant="card"
          action={
            search || statusFilter !== "all" ? (
              <Button
                variant="outline"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("all");
                }}
                className="bg-background-secondary hover:bg-background-tertiary"
              >
                Clear filters
              </Button>
            ) : (
              <CreateRunDialog />
            )
          }
        />
      ) : (
        <div className="space-y-2">
          {/* Results count */}
          {(search || statusFilter !== "all") && (
            <p className="text-xs text-muted-foreground mb-4 animate-fade-in">
              Showing {filteredRuns.length} of {totalRuns} runs
            </p>
          )}

          {/* Run list with staggered animation */}
          <div className="space-y-2">
            {filteredRuns.map((run, index) => (
              <RunListItem key={run.id} run={run} index={index} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
