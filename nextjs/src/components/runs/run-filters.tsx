"use client";

import { Search, X, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RunStatus } from "@/types/run";

interface StatusFilterConfig {
  label: string;
  value: RunStatus | "all";
  color?: string;
  dotClass?: string;
}

const statusFilters: StatusFilterConfig[] = [
  { label: "All", value: "all" },
  { label: "Running", value: "running", color: "text-accent-yellow", dotClass: "bg-accent-yellow" },
  { label: "Waiting", value: "waiting_approval", color: "text-accent-purple", dotClass: "bg-accent-purple" },
  { label: "Completed", value: "completed", color: "text-accent-green", dotClass: "bg-accent-green" },
  { label: "Failed", value: "failed", color: "text-accent-red", dotClass: "bg-accent-red" },
];

interface RunFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: RunStatus | "all";
  onStatusChange: (value: RunStatus | "all") => void;
}

export function RunFilters({
  search,
  onSearchChange,
  statusFilter,
  onStatusChange,
}: RunFiltersProps) {
  const hasActiveFilters = search || statusFilter !== "all";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search input */}
        <div className="relative flex-1 max-w-md group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-accent-blue" />
          <Input
            placeholder="Search by ID, agent, or task..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className={cn(
              "pl-10 pr-10 h-10",
              "bg-background-secondary border-border/50",
              "placeholder:text-muted-foreground/50",
              "focus:border-accent-blue/50 focus:bg-background",
              "transition-all duration-200"
            )}
          />
          {search && (
            <button
              onClick={() => onSearchChange("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-sm text-muted-foreground hover:text-foreground hover:bg-background-tertiary transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Status filter pills */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-background-secondary border border-border/30">
          {statusFilters.map((filter) => {
            const isActive = statusFilter === filter.value;
            return (
              <button
                key={filter.value}
                onClick={() => onStatusChange(filter.value)}
                className={cn(
                  "relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200",
                  isActive
                    ? "bg-background-tertiary text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-background-tertiary/50"
                )}
              >
                {filter.dotClass && (
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full transition-opacity",
                      filter.dotClass,
                      isActive ? "opacity-100" : "opacity-50"
                    )}
                  />
                )}
                {filter.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active filters indicator */}
      {hasActiveFilters && (
        <div className="flex items-center gap-2 animate-fade-in">
          <Filter className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Active filters:</span>
          <div className="flex items-center gap-1">
            {search && (
              <Badge
                variant="secondary"
                className="text-xs h-5 px-2 bg-background-tertiary border-border/30 gap-1"
              >
                Search: &quot;{search.slice(0, 20)}{search.length > 20 ? "..." : ""}&quot;
                <button
                  onClick={() => onSearchChange("")}
                  className="ml-0.5 hover:text-foreground"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            )}
            {statusFilter !== "all" && (
              <Badge
                variant="secondary"
                className="text-xs h-5 px-2 bg-background-tertiary border-border/30 gap-1"
              >
                Status: {statusFilters.find(f => f.value === statusFilter)?.label}
                <button
                  onClick={() => onStatusChange("all")}
                  className="ml-0.5 hover:text-foreground"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            )}
          </div>
          <button
            onClick={() => {
              onSearchChange("");
              onStatusChange("all");
            }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-2"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
