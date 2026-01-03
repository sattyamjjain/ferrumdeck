"use client";

import {
  DollarSign,
  Hash,
  Clock,
  Zap,
  MoreVertical,
  Pencil,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Budget, BudgetType, BudgetPeriod, BudgetStatus } from "@/types/policy";

const typeConfig: Record<BudgetType, { label: string; icon: typeof DollarSign; unit: string }> = {
  cost: { label: "Cost", icon: DollarSign, unit: "cents" },
  tokens: { label: "Tokens", icon: Hash, unit: "tokens" },
  calls: { label: "Tool Calls", icon: Zap, unit: "calls" },
  time: { label: "Wall Time", icon: Clock, unit: "ms" },
};

const periodConfig: Record<BudgetPeriod, { label: string; shortLabel: string }> = {
  per_run: { label: "Per Run", shortLabel: "run" },
  hourly: { label: "Hourly", shortLabel: "hour" },
  daily: { label: "Daily (24h)", shortLabel: "day" },
  weekly: { label: "Weekly", shortLabel: "week" },
  monthly: { label: "Monthly", shortLabel: "month" },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const statusConfig: Record<BudgetStatus, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-green-500/20 text-green-400 border-green-500/30" },
  inactive: { label: "Inactive", className: "bg-secondary text-secondary-foreground border-border" },
  exceeded: { label: "Exceeded", className: "bg-red-500/20 text-red-400 border-red-500/30" },
};

function formatBudgetValue(value: number, type: BudgetType): string {
  switch (type) {
    case "cost":
      if (value >= 100) {
        return `$${(value / 100).toFixed(2)}`;
      }
      return `${value}c`;
    case "tokens":
      if (value >= 1000000) {
        return `${(value / 1000000).toFixed(1)}M`;
      }
      if (value >= 1000) {
        return `${(value / 1000).toFixed(1)}K`;
      }
      return String(value);
    case "calls":
      return String(value);
    case "time":
      if (value >= 60000) {
        return `${(value / 60000).toFixed(1)}m`;
      }
      if (value >= 1000) {
        return `${(value / 1000).toFixed(1)}s`;
      }
      return `${value}ms`;
  }
}

interface ProgressBarProps {
  percentage: number;
  status: BudgetStatus;
}

function ProgressBar({ percentage, status }: ProgressBarProps) {
  const clampedPercentage = Math.min(100, Math.max(0, percentage));

  let barColor = "bg-accent-blue";
  if (percentage >= 90 || status === "exceeded") {
    barColor = "bg-red-500";
  } else if (percentage >= 75) {
    barColor = "bg-yellow-500";
  } else if (percentage >= 50) {
    barColor = "bg-orange-500";
  }

  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-300", barColor)}
          style={{ width: `${clampedPercentage}%` }}
        />
      </div>
      <span className={cn(
        "text-xs font-mono tabular-nums w-12 text-right",
        percentage >= 90 ? "text-red-400" : "text-muted-foreground"
      )}>
        {percentage.toFixed(0)}%
      </span>
    </div>
  );
}

interface BudgetTableProps {
  budgets: Budget[];
  onEdit?: (budget: Budget) => void;
  onDelete?: (budget: Budget) => void;
  isAdmin?: boolean;
  isLoading?: boolean;
}

export function BudgetTable({
  budgets,
  onEdit,
  onDelete,
  isAdmin = false,
  isLoading = false,
}: BudgetTableProps) {
  if (isLoading) {
    return (
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[200px]">Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Limit</TableHead>
              <TableHead>Period</TableHead>
              <TableHead className="w-[180px]">Usage</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 3 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell>
                  <div className="h-4 w-32 bg-muted rounded animate-pulse" />
                </TableCell>
                <TableCell>
                  <div className="h-4 w-16 bg-muted rounded animate-pulse" />
                </TableCell>
                <TableCell>
                  <div className="h-4 w-20 bg-muted rounded animate-pulse" />
                </TableCell>
                <TableCell>
                  <div className="h-4 w-16 bg-muted rounded animate-pulse" />
                </TableCell>
                <TableCell>
                  <div className="h-2 w-full bg-muted rounded animate-pulse" />
                </TableCell>
                <TableCell>
                  <div className="h-4 w-4 bg-muted rounded animate-pulse" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  if (budgets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <DollarSign className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
        <h3 className="text-sm font-medium mb-1">No budgets configured</h3>
        <p className="text-xs text-muted-foreground">
          Create a budget to set spending and usage limits
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[200px]">Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Limit</TableHead>
            <TableHead>Period</TableHead>
            <TableHead className="w-[180px]">Usage</TableHead>
            <TableHead className="w-[50px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {budgets.map((budget) => {
            const type = typeConfig[budget.budget_type] || typeConfig.cost;
            const period = periodConfig[budget.period] || periodConfig.per_run;
            const TypeIcon = type.icon;

            return (
              <TableRow key={budget.id}>
                <TableCell>
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{budget.name}</span>
                      {budget.status === "exceeded" && (
                        <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                      )}
                    </div>
                    {budget.description && (
                      <span className="text-xs text-muted-foreground line-clamp-1">
                        {budget.description}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <TypeIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm">{type.label}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="font-mono text-sm">
                    {formatBudgetValue(budget.limit, budget.budget_type)}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">
                    {period.label}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <ProgressBar
                      percentage={budget.usage_percentage}
                      status={budget.status}
                    />
                    <span className="text-xs text-muted-foreground">
                      {formatBudgetValue(budget.current_usage, budget.budget_type)} / {formatBudgetValue(budget.limit, budget.budget_type)}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                        <span className="sr-only">Actions</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit?.(budget)}>
                        <Pencil className="h-4 w-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                      {isAdmin && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => onDelete?.(budget)}
                            className="text-red-400 focus:text-red-400"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
