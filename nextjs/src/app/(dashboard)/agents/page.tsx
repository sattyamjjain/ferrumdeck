"use client";

import { useState, useMemo } from "react";
import { Bot, Search, X, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AgentList } from "@/components/agents/agent-list";
import { CreateAgentDialog } from "@/components/agents/create-agent-dialog";
import { useAgents } from "@/hooks/use-agents";
import type { AgentStatus } from "@/types/agent";

interface StatusFilterConfig {
  label: string;
  value: AgentStatus | "all";
  dotClass?: string;
}

const statusFilters: StatusFilterConfig[] = [
  { label: "All", value: "all" },
  { label: "Active", value: "active", dotClass: "bg-accent-green" },
  { label: "Draft", value: "draft", dotClass: "bg-accent-yellow" },
  { label: "Deprecated", value: "deprecated", dotClass: "bg-accent-orange" },
  { label: "Archived", value: "archived", dotClass: "bg-muted-foreground" },
];

export default function AgentsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<AgentStatus | "all">("all");

  const { data: agents, isLoading, error } = useAgents({
    status: statusFilter,
    search: search.trim() || undefined,
  });

  // Client-side filtering for search (in case the API doesn't support it)
  const filteredAgents = useMemo(() => {
    if (!agents) return [];
    if (!search.trim()) return agents;

    const searchLower = search.toLowerCase();
    return agents.filter(
      (agent) =>
        agent.name.toLowerCase().includes(searchLower) ||
        agent.slug.toLowerCase().includes(searchLower) ||
        agent.description?.toLowerCase().includes(searchLower)
    );
  }, [agents, search]);

  const hasActiveFilters = search || statusFilter !== "all";

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Page header with gradient accent */}
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/5 via-transparent to-transparent rounded-xl -z-10" />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 pb-2">
            <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
              <Bot className="h-5 w-5 text-indigo-400" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Agent Registry</h1>
              <p className="text-sm text-muted-foreground">
                Configure and manage AI agent definitions
              </p>
            </div>
          </div>
          <CreateAgentDialog />
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search input */}
          <div className="relative flex-1 max-w-md group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-accent-blue" />
            <Input
              placeholder="Search agents by name, slug, or description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
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
                onClick={() => setSearch("")}
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
                  onClick={() => setStatusFilter(filter.value)}
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
                  Search: &quot;{search.slice(0, 20)}
                  {search.length > 20 ? "..." : ""}&quot;
                  <button
                    onClick={() => setSearch("")}
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
                  Status: {statusFilters.find((f) => f.value === statusFilter)?.label}
                  <button
                    onClick={() => setStatusFilter("all")}
                    className="ml-0.5 hover:text-foreground"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </Badge>
              )}
            </div>
            <button
              onClick={() => {
                setSearch("");
                setStatusFilter("all");
              }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-2"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      <AgentList agents={filteredAgents} isLoading={isLoading} error={error} />
    </div>
  );
}
