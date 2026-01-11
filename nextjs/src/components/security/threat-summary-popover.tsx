"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Threat, ThreatSummary } from "@/types/security";
import { ThreatCountBadge } from "./threat-count-badge";
import { SecurityBadge, ViolationBadge } from "./security-badge";
import { ShieldAlert, ExternalLink, Shield } from "lucide-react";
import Link from "next/link";

interface ThreatSummaryPopoverProps {
  runId: string;
  summary?: ThreatSummary;
  threats?: Threat[];
  className?: string;
}

export function ThreatSummaryPopover({
  runId,
  summary,
  threats,
  className,
}: ThreatSummaryPopoverProps) {
  const threatCount = summary?.total_threats ?? threats?.length ?? 0;
  const highestRisk = summary?.highest_risk_level ?? threats?.[0]?.risk_level;

  if (threatCount === 0) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={cn("focus:outline-none", className)}>
          <ThreatCountBadge
            count={threatCount}
            highestRiskLevel={highestRisk}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="p-4 border-b border-border/50">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-foreground-muted" />
            <h4 className="font-semibold text-foreground">Security Summary</h4>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* Summary stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <p className="text-xs text-foreground-muted">Total Threats</p>
              <p className="text-lg font-bold text-foreground">{threatCount}</p>
            </div>
            {highestRisk && (
              <div className="space-y-1">
                <p className="text-xs text-foreground-muted">Highest Risk</p>
                <SecurityBadge riskLevel={highestRisk} size="sm" />
              </div>
            )}
            {summary && (
              <>
                <div className="space-y-1">
                  <p className="text-xs text-foreground-muted">Blocked</p>
                  <p className="text-lg font-bold text-red-500">
                    {summary.blocked_count}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-foreground-muted">Logged</p>
                  <p className="text-lg font-bold text-yellow-500">
                    {summary.logged_count}
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Violation types */}
          {summary?.violation_types && summary.violation_types.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-foreground-muted uppercase tracking-wider">
                Violation Types
              </p>
              <div className="flex flex-wrap gap-1.5">
                {summary.violation_types.map((type) => (
                  <ViolationBadge
                    key={type}
                    violationType={type}
                    size="sm"
                  />
                ))}
              </div>
            </div>
          )}

          {/* Recent threats */}
          {threats && threats.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-foreground-muted uppercase tracking-wider">
                Recent Threats
              </p>
              <div className="space-y-2">
                {threats.slice(0, 3).map((threat) => (
                  <div
                    key={threat.id}
                    className="flex items-center justify-between p-2 rounded bg-secondary/30"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Shield
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          threat.risk_level === "critical"
                            ? "text-red-500"
                            : threat.risk_level === "high"
                            ? "text-orange-500"
                            : "text-yellow-500"
                        )}
                      />
                      <span className="text-xs font-mono truncate">
                        {threat.tool_name}
                      </span>
                    </div>
                    <span
                      className={cn(
                        "text-[10px] font-medium shrink-0",
                        threat.action === "blocked"
                          ? "text-red-500"
                          : "text-yellow-500"
                      )}
                    >
                      {threat.action}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer with link */}
        <div className="p-3 border-t border-border/50 bg-secondary/20">
          <Link
            href={`/threats?run_id=${runId}`}
            className="flex items-center justify-center gap-1.5 text-xs text-accent-blue hover:underline"
          >
            View all threats
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
