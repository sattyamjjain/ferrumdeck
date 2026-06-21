"use client";

import { Eye, Gauge, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ResponseLevel } from "@/types/run";

interface ResponseLevelBadgeProps {
  /** The graduated response rung last applied on the run. */
  responseLevel?: ResponseLevel;
}

const CONFIG: Record<
  ResponseLevel,
  {
    rung: string;
    label: string;
    variant: "low" | "medium" | "high";
    icon: typeof Eye;
    tip: string;
  }
> = {
  allow_and_log: {
    rung: "R1",
    label: "Allow + log",
    variant: "low",
    icon: Eye,
    tip: "Reversible action — monitored and logged for async review; no gate.",
  },
  allow_under_budget: {
    rung: "R2",
    label: "Allow under budget",
    variant: "medium",
    icon: Gauge,
    tip: "Costly but recoverable — allowed while the run's budget gate has headroom; escalates to approval once exhausted.",
  },
  require_approval: {
    rung: "R3",
    label: "Require approval",
    variant: "high",
    icon: ShieldAlert,
    tip: "Irreversible (or budget-exhausted) — requires human-in-the-loop approval before it can proceed.",
  },
};

/**
 * Compact badge surfaced on the run header showing the reversibility-aware
 * graduated response level (DeepMind AI Control Roadmap R1-R3 ladder) last
 * applied to a tool call on this run. Reads the polled run endpoint's
 * `response_level`; returns null for legacy runs that never hit a policy check.
 */
export function ResponseLevelBadge({ responseLevel }: ResponseLevelBadgeProps) {
  if (!responseLevel) return null;
  const cfg = CONFIG[responseLevel];
  if (!cfg) return null;
  const Icon = cfg.icon;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant={cfg.variant} className="gap-1.5">
          <Icon className="h-3 w-3" />
          {cfg.rung} · {cfg.label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <div className="max-w-[260px] space-y-1 text-xs">
          <div className="font-medium">Graduated response · {cfg.rung}</div>
          <div className="text-muted-foreground">{cfg.tip}</div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
