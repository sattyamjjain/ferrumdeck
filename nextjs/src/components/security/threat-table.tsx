"use client";

import { cn } from "@/lib/utils";
import type { Threat } from "@/types/security";
import { SecurityBadge, ViolationBadge } from "./security-badge";
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
import { formatDistanceToNow, format } from "date-fns";
import { ExternalLink, Shield, ChevronRight } from "lucide-react";
import Link from "next/link";

interface ThreatTableProps {
  threats: Threat[];
  className?: string;
  showRunLink?: boolean;
  onThreatClick?: (threat: Threat) => void;
}

export function ThreatTable({
  threats,
  className,
  showRunLink = true,
  onThreatClick,
}: ThreatTableProps) {
  if (threats.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center py-16 rounded-xl border border-border/50 bg-background-secondary/30",
          className
        )}
      >
        <div className="p-4 rounded-full bg-emerald-500/10 mb-4">
          <Shield className="h-10 w-10 text-emerald-400" />
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-1">
          No threats detected
        </h3>
        <p className="text-sm text-muted-foreground max-w-sm text-center">
          Airlock is actively monitoring tool calls for security violations. All clear!
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-border/50 overflow-hidden bg-background-secondary/30 backdrop-blur-sm",
        className
      )}
    >
      <Table>
        <TableHeader>
          <TableRow className="bg-background-tertiary/50 hover:bg-background-tertiary/50 border-b border-border/50">
            <TableHead className="w-[140px] text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Time
            </TableHead>
            {showRunLink && (
              <TableHead className="w-[120px] text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Run
              </TableHead>
            )}
            <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Tool
            </TableHead>
            <TableHead className="w-[160px] text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Violation
            </TableHead>
            <TableHead className="w-[100px] text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Risk
            </TableHead>
            <TableHead className="w-[90px] text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Action
            </TableHead>
            <TableHead className="w-[50px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {threats.map((threat, index) => (
            <TableRow
              key={threat.id}
              className={cn(
                "cursor-pointer transition-all duration-200 group",
                "hover:bg-background-elevated/50",
                "border-b border-border/30 last:border-b-0",
                threat.risk_level === "critical" &&
                  "bg-red-500/[0.03] hover:bg-red-500/[0.06]",
                threat.risk_level === "high" &&
                  "bg-orange-500/[0.02] hover:bg-orange-500/[0.05]"
              )}
              style={{ animationDelay: `${index * 30}ms` }}
              onClick={() => onThreatClick?.(threat)}
            >
              <TableCell className="py-3">
                <div className="flex flex-col">
                  <span className="font-mono text-xs text-foreground">
                    {format(new Date(threat.created_at), "HH:mm:ss")}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatDistanceToNow(new Date(threat.created_at), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
              </TableCell>

              {showRunLink && (
                <TableCell className="py-3">
                  <Link
                    href={`/runs/${threat.run_id}`}
                    className={cn(
                      "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-mono",
                      "bg-accent-blue/10 text-accent-blue border border-accent-blue/20",
                      "hover:bg-accent-blue/20 hover:border-accent-blue/30 transition-colors"
                    )}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {threat.run_id.slice(0, 8)}
                    <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                  </Link>
                </TableCell>
              )}

              <TableCell className="py-3">
                <code className="px-2 py-1 rounded-md bg-background-tertiary border border-border/50 text-sm font-mono">
                  {threat.tool_name}
                </code>
              </TableCell>

              <TableCell className="py-3">
                <ViolationBadge violationType={threat.violation_type} size="sm" />
              </TableCell>

              <TableCell className="py-3">
                <SecurityBadge riskLevel={threat.risk_level} size="sm" />
              </TableCell>

              <TableCell className="py-3">
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] font-semibold uppercase tracking-wide",
                    threat.action === "blocked"
                      ? "bg-red-500/10 text-red-400 border-red-500/30"
                      : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                  )}
                >
                  {threat.action}
                </Badge>
              </TableCell>

              <TableCell className="py-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity",
                    "hover:bg-accent-primary/10"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    onThreatClick?.(threat);
                  }}
                >
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
