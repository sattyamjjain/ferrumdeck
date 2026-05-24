"use client";

import { TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { BudgetBreachKind } from "@/types/run";

interface BudgetProjectionBadgeProps {
  /** Latest linear projection of end-of-run cost in cents. */
  projectedCostCents?: number;
  /** EWMA-smoothed projection of end-of-run cost in cents. */
  ewmaCostCents?: number;
  /** True when the gateway has flagged the run as projected to breach. */
  breachProjected?: boolean;
  /** Axis on which the breach is projected, if any. */
  breachKind?: BudgetBreachKind | null;
  /** When the gateway emitted the snapshot — shown in the tooltip. */
  forecastAt?: string;
}

function formatDollars(cents: number | undefined): string {
  if (cents === undefined || cents === null || Number.isNaN(cents)) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

function breachLabel(kind: BudgetBreachKind | null | undefined): string {
  switch (kind) {
    case "cost_cents":
      return "cost cap";
    case "tool_calls":
      return "tool-call cap";
    case "wall_time":
      return "wall-time cap";
    default:
      return "budget";
  }
}

/**
 * Compact badge surfaced on the run header when the governance plane projects
 * the run will exceed its configured budget before completion. Stays hidden
 * (returns null) when no forecast has been produced or no breach is projected.
 */
export function BudgetProjectionBadge({
  projectedCostCents,
  ewmaCostCents,
  breachProjected,
  breachKind,
  forecastAt,
}: BudgetProjectionBadgeProps) {
  if (!breachProjected) return null;

  const projected = formatDollars(projectedCostCents);
  const ewma = formatDollars(ewmaCostCents);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="critical" pulse className="gap-1.5">
          <TrendingUp className="h-3 w-3" />
          Projected to exceed {breachLabel(breachKind)}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-1 text-xs">
          <div>
            <span className="text-muted-foreground">Linear projection:</span>{" "}
            <span className="font-medium">{projected}</span>
          </div>
          <div>
            <span className="text-muted-foreground">EWMA projection:</span>{" "}
            <span className="font-medium">{ewma}</span>
          </div>
          {forecastAt ? (
            <div className="text-muted-foreground">
              Updated {new Date(forecastAt).toLocaleTimeString()}
            </div>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
