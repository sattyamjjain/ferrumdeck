"use client";

import { cn } from "@/lib/utils";
import type { RiskLevel } from "@/types";
import type { ViolationType, ThreatAction, ThreatsParams } from "@/types/security";
import { getViolationTypeLabel } from "@/types/security";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X, Search, SlidersHorizontal } from "lucide-react";

const RISK_LEVELS: RiskLevel[] = ["critical", "high", "medium", "low"];
const VIOLATION_TYPES: ViolationType[] = [
  "rcepattern",
  "velocitybreach",
  "loopdetection",
  "exfiltrationattempt",
  "ipaddressused",
];
const ACTIONS: ThreatAction[] = ["blocked", "logged"];

interface ThreatFiltersProps {
  params: ThreatsParams;
  onChange: (params: ThreatsParams) => void;
  className?: string;
}

export function ThreatFilters({
  params,
  onChange,
  className,
}: ThreatFiltersProps) {
  const hasFilters =
    params.risk_level || params.violation_type || params.action || params.run_id;

  const activeFilterCount = [
    params.risk_level,
    params.violation_type,
    params.action,
    params.run_id,
  ].filter(Boolean).length;

  const clearFilters = () => {
    onChange({
      limit: params.limit,
      offset: 0,
    });
  };

  const updateFilter = (key: keyof ThreatsParams, value: string | undefined) => {
    onChange({
      ...params,
      [key]: value === "all" ? undefined : value,
      offset: 0, // Reset pagination when filtering
    });
  };

  return (
    <div className={cn("space-y-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-accent-primary/10">
            <SlidersHorizontal className="h-4 w-4 text-accent-primary" />
          </div>
          <span className="text-sm font-medium text-foreground">Filters</span>
          {activeFilterCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-accent-primary/10 text-accent-primary text-xs font-semibold">
              {activeFilterCount} active
            </span>
          )}
        </div>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="h-8 px-3 text-xs hover:bg-red-500/10 hover:text-red-400 transition-colors"
          >
            <X className="h-3 w-3 mr-1.5" />
            Clear all
          </Button>
        )}
      </div>

      {/* Filter controls */}
      <div className="flex flex-wrap gap-4">
        {/* Run ID filter */}
        <div className="flex-1 min-w-[220px] space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Run ID
          </Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filter by run ID..."
              value={params.run_id || ""}
              onChange={(e) => updateFilter("run_id", e.target.value || undefined)}
              className={cn(
                "h-10 pl-10 bg-background/50 border-border/50",
                "focus:bg-background focus:border-accent-primary/50",
                "placeholder:text-muted-foreground/60"
              )}
            />
          </div>
        </div>

        {/* Risk Level filter */}
        <div className="w-[150px] space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Risk Level
          </Label>
          <Select
            value={params.risk_level || "all"}
            onValueChange={(value) => updateFilter("risk_level", value)}
          >
            <SelectTrigger
              className={cn(
                "h-10 bg-background/50 border-border/50",
                params.risk_level && "border-accent-primary/50 bg-accent-primary/5"
              )}
            >
              <SelectValue placeholder="All levels" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All levels</SelectItem>
              {RISK_LEVELS.map((level) => (
                <SelectItem key={level} value={level}>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "w-2 h-2 rounded-full",
                        level === "critical" && "bg-red-500",
                        level === "high" && "bg-orange-500",
                        level === "medium" && "bg-yellow-500",
                        level === "low" && "bg-blue-500"
                      )}
                    />
                    <span className="capitalize">{level}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Violation Type filter */}
        <div className="w-[200px] space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Violation Type
          </Label>
          <Select
            value={params.violation_type || "all"}
            onValueChange={(value) => updateFilter("violation_type", value)}
          >
            <SelectTrigger
              className={cn(
                "h-10 bg-background/50 border-border/50",
                params.violation_type &&
                  "border-accent-primary/50 bg-accent-primary/5"
              )}
            >
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {VIOLATION_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {getViolationTypeLabel(type)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Action filter */}
        <div className="w-[130px] space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Action
          </Label>
          <Select
            value={params.action || "all"}
            onValueChange={(value) => updateFilter("action", value)}
          >
            <SelectTrigger
              className={cn(
                "h-10 bg-background/50 border-border/50",
                params.action && "border-accent-primary/50 bg-accent-primary/5"
              )}
            >
              <SelectValue placeholder="All actions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              {ACTIONS.map((action) => (
                <SelectItem key={action} value={action}>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "w-2 h-2 rounded-full",
                        action === "blocked" ? "bg-red-500" : "bg-amber-500"
                      )}
                    />
                    <span className="capitalize">{action}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
