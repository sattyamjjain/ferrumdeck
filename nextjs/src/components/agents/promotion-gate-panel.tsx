"use client";

import {
  ArrowRight,
  CheckCircle2,
  Clock,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useAgentPromotions } from "@/hooks/use-promotions";
import type {
  MetricEvidence,
  PromotionDecision,
  PromotionStatus,
} from "@/types/promotion";

interface PromotionGatePanelProps {
  agentId: string;
}

const statusConfig: Record<
  PromotionStatus,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  promoted: {
    label: "Promoted",
    className: "bg-green-500/20 text-green-400 border-green-500/30",
    icon: CheckCircle2,
  },
  denied: {
    label: "Denied",
    className: "bg-red-500/20 text-red-400 border-red-500/30",
    icon: XCircle,
  },
  awaiting_approval: {
    label: "Awaiting approval",
    className: "bg-accent-yellow/20 text-accent-yellow border-accent-yellow/30",
    icon: Clock,
  },
  shadow: {
    label: "Shadow",
    className: "bg-secondary text-secondary-foreground border-border",
    icon: ShieldCheck,
  },
};

/**
 * Champion-challenger promotion gate panel.
 *
 * Surfaces the latest gate decision (challenger vs champion + status) and the
 * full audited history. Reads the agent's audit-backed promotion history via
 * TanStack Query; renders `null` when the agent has no recorded promotion
 * decisions so legacy agents are unaffected.
 */
export function PromotionGatePanel({ agentId }: PromotionGatePanelProps) {
  const { data, isLoading } = useAgentPromotions(agentId);

  if (isLoading) {
    return (
      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-4 w-72 mt-2" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  const decisions = data?.decisions ?? [];
  if (decisions.length === 0) {
    return null;
  }

  const latest = decisions[0];
  const cfg = statusConfig[latest.status];
  const StatusIcon = cfg.icon;

  return (
    <Card
      className={cn(
        "bg-card/50",
        latest.status === "denied"
          ? "border-red-500/30"
          : latest.status === "promoted"
            ? "border-green-500/20"
            : "border-border/50"
      )}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-background-secondary flex items-center justify-center shrink-0">
              <ShieldCheck className="h-5 w-5 text-accent-purple" />
            </div>
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                Promotion gate
                <Badge
                  variant="outline"
                  className={cn("text-xs gap-1", cfg.className)}
                >
                  <StatusIcon className="h-3 w-3" />
                  {cfg.label}
                </Badge>
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">
                A challenger stays in shadow until it clears the gate
                (metric thresholds + human approval). Deny-by-default.
              </CardDescription>
            </div>
          </div>
          {latest.anchor ? (
            <Badge
              variant="outline"
              className="border-accent-purple/30 text-accent-purple text-xs"
            >
              {latest.anchor}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Champion → challenger binding for the latest decision */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline" className="font-mono">
            champion: {latest.champion_version_id ?? "—"}
          </Badge>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <Badge
            variant="outline"
            className={cn(
              "font-mono",
              latest.status === "promoted"
                ? "border-green-500/30 text-green-400"
                : "border-accent-purple/30 text-accent-purple"
            )}
          >
            challenger: {latest.challenger_version_id}
          </Badge>
        </div>

        {/* Metric evidence for the latest decision */}
        <MetricEvidenceTable evidence={latest.metric_evidence} reason={latest.reason} />

        {/* Decision history */}
        {decisions.length > 1 ? <PromotionHistory decisions={decisions} /> : null}
      </CardContent>
    </Card>
  );
}

function MetricEvidenceTable({
  evidence,
  reason,
}: {
  evidence: MetricEvidence[];
  reason: string;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        Gate evidence
      </div>
      {evidence.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Metric</TableHead>
              <TableHead className="text-right">Floor</TableHead>
              <TableHead className="text-right">Measured</TableHead>
              <TableHead className="text-right">Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {evidence.map((e) => (
              <TableRow key={e.name}>
                <TableCell className="font-mono text-xs">{e.name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {e.min_value}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {e.measured_value ?? "—"}
                </TableCell>
                <TableCell className="text-right">
                  {e.passed ? (
                    <span className="text-green-400 inline-flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> pass
                    </span>
                  ) : (
                    <span className="text-red-400 inline-flex items-center gap-1">
                      <XCircle className="h-3 w-3" /> fail
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      <p className="text-xs text-muted-foreground">{reason}</p>
    </div>
  );
}

function PromotionHistory({ decisions }: { decisions: PromotionDecision[] }) {
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        Decision history ({decisions.length})
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Challenger</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Approval</TableHead>
            <TableHead className="text-right">When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {decisions.map((d) => {
            const cfg = statusConfig[d.status];
            return (
              <TableRow key={d.id}>
                <TableCell className="font-mono text-xs">
                  {d.challenger_version_id}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn("text-[10px]", cfg.className)}
                  >
                    {cfg.label}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {d.approval_required
                    ? d.approval_present
                      ? "approved"
                      : "required"
                    : "not required"}
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">
                  {formatWhen(d.decided_at)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
