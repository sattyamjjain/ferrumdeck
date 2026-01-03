"use client";

import { useState, useEffect } from "react";
import { Search, X, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { ToolRiskLevel, ToolHealthStatus, ToolStatus } from "@/types/tool";

interface ToolFiltersProps {
  search: string;
  riskLevel: ToolRiskLevel | undefined;
  mcpServer: string | undefined;
  status: ToolStatus | undefined;
  healthStatus: ToolHealthStatus | undefined;
  mcpServers: string[];
  onSearchChange: (value: string) => void;
  onRiskLevelChange: (value: ToolRiskLevel | undefined) => void;
  onMcpServerChange: (value: string | undefined) => void;
  onStatusChange: (value: ToolStatus | undefined) => void;
  onHealthStatusChange: (value: ToolHealthStatus | undefined) => void;
  onClearFilters: () => void;
}

export function ToolFilters({
  search,
  riskLevel,
  mcpServer,
  status,
  healthStatus,
  mcpServers,
  onSearchChange,
  onRiskLevelChange,
  onMcpServerChange,
  onStatusChange,
  onHealthStatusChange,
  onClearFilters,
}: ToolFiltersProps) {
  // Hydration fix - ensure client-only rendering for Radix components
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const hasFilters = !!riskLevel || !!mcpServer || !!status || !!healthStatus;
  const activeFilterCount = [riskLevel, mcpServer, status, healthStatus].filter(Boolean).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search tools..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 bg-background-secondary border-border"
          />
          {search && (
            <button
              onClick={() => onSearchChange("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Risk Level Filter */}
        {mounted && (
          <Select
            value={riskLevel || "all"}
            onValueChange={(v) => onRiskLevelChange(v === "all" ? undefined : (v as ToolRiskLevel))}
          >
            <SelectTrigger className="w-[140px] bg-background-secondary border-border">
              <SelectValue placeholder="Risk Level" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Risks</SelectItem>
              <SelectItem value="low">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-accent-green" />
                  Low
                </div>
              </SelectItem>
              <SelectItem value="medium">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-accent-yellow" />
                  Medium
                </div>
              </SelectItem>
              <SelectItem value="high">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-accent-orange" />
                  High
                </div>
              </SelectItem>
              <SelectItem value="critical">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-accent-red" />
                  Critical
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        )}

        {/* MCP Server Filter */}
        {mounted && (
          <Select
            value={mcpServer || "all"}
            onValueChange={(v) => onMcpServerChange(v === "all" ? undefined : v)}
          >
            <SelectTrigger className="w-[180px] bg-background-secondary border-border">
              <SelectValue placeholder="MCP Server" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Servers</SelectItem>
              {mcpServers.map((server) => (
                <SelectItem key={server} value={server}>
                  <span className="font-mono text-sm">{server}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Status Filter */}
        {mounted && (
          <Select
            value={healthStatus || "all"}
            onValueChange={(v) => onHealthStatusChange(v === "all" ? undefined : (v as ToolHealthStatus))}
          >
            <SelectTrigger className="w-[130px] bg-background-secondary border-border">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="ok">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-accent-green" />
                  OK
                </div>
              </SelectItem>
              <SelectItem value="slow">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-accent-yellow" />
                  Slow
                </div>
              </SelectItem>
              <SelectItem value="error">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-accent-red" />
                  Error
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        )}

        {/* Tool Status Filter (Active/Deprecated/Disabled) */}
        {mounted && (
          <Select
            value={status || "all"}
            onValueChange={(v) => onStatusChange(v === "all" ? undefined : (v as ToolStatus))}
          >
            <SelectTrigger className="w-[140px] bg-background-secondary border-border">
              <SelectValue placeholder="Tool Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="deprecated">Deprecated</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
            </SelectContent>
          </Select>
        )}

        {/* Clear Filters */}
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearFilters}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4 mr-1" />
            Clear filters
          </Button>
        )}
      </div>

      {/* Active Filters Summary */}
      {hasFilters && (
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            {activeFilterCount} filter{activeFilterCount !== 1 ? "s" : ""} active:
          </span>
          <div className="flex flex-wrap gap-1.5">
            {riskLevel && (
              <Badge
                variant="secondary"
                className="text-xs py-0 px-2 gap-1 cursor-pointer hover:bg-secondary/80"
                onClick={() => onRiskLevelChange(undefined)}
              >
                Risk: {riskLevel}
                <X className="h-3 w-3" />
              </Badge>
            )}
            {mcpServer && (
              <Badge
                variant="secondary"
                className="text-xs py-0 px-2 gap-1 cursor-pointer hover:bg-secondary/80"
                onClick={() => onMcpServerChange(undefined)}
              >
                Server: {mcpServer}
                <X className="h-3 w-3" />
              </Badge>
            )}
            {healthStatus && (
              <Badge
                variant="secondary"
                className="text-xs py-0 px-2 gap-1 cursor-pointer hover:bg-secondary/80"
                onClick={() => onHealthStatusChange(undefined)}
              >
                Health: {healthStatus}
                <X className="h-3 w-3" />
              </Badge>
            )}
            {status && (
              <Badge
                variant="secondary"
                className="text-xs py-0 px-2 gap-1 cursor-pointer hover:bg-secondary/80"
                onClick={() => onStatusChange(undefined)}
              >
                Status: {status}
                <X className="h-3 w-3" />
              </Badge>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
