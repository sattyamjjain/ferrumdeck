"use client";

import { useMemo } from "react";
import {
  RadialBar,
  RadialBarChart,
  PolarAngleAxis,
  ResponsiveContainer,
} from "recharts";
import {
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  ExternalLink,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type {
  BenchAuditReport,
  BenchFlagSeverity,
  BenchHygieneClass,
} from "@/types/eval";

interface BenchTrustCardProps {
  audit: BenchAuditReport;
  /** Minimum trust required to allow benchmark-gated routing decisions. */
  minTrustScore?: number;
  /** Below this is HITL (requires approval); above this is allowed. */
  allowAboveScore?: number;
}

const HYGIENE_CLASS_LABELS: Record<BenchHygieneClass, string> = {
  ambiguous_spec: "Ambiguous spec",
  env_conflict: "Env conflict",
  brittle_grading: "Brittle grading",
  suspect_truth: "Suspect truth",
};

const SEVERITY_STYLES: Record<BenchFlagSeverity, string> = {
  low: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
  medium: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  high: "bg-red-500/15 text-red-300 border-red-500/30",
};

/**
 * Card surfacing the ABA benchmark-audit pre-flight (arXiv:2605.26079) on the
 * eval-run detail view. Reuses the project's existing Recharts + TanStack-Query
 * patterns; the audit data itself comes from `EvalRun.bench_audit`, which the
 * eval plane denormalises onto the run row.
 */
export function BenchTrustCard({
  audit,
  minTrustScore = 0.7,
  allowAboveScore = 0.85,
}: BenchTrustCardProps) {
  const trustPct = Math.round(audit.bench_trust_score * 100);
  const verdict = classifyTrust(
    audit.bench_trust_score,
    minTrustScore,
    allowAboveScore
  );

  const chartData = useMemo(
    () => [
      {
        name: "trust",
        value: trustPct,
        fill: verdict.fill,
      },
    ],
    [trustPct, verdict.fill]
  );

  const VerdictIcon = verdict.icon;
  const auditedAt = useMemo(() => {
    try {
      return new Date(audit.audited_at).toLocaleString();
    } catch {
      return audit.audited_at;
    }
  }, [audit.audited_at]);

  return (
    <Card className={cn("border", verdict.cardBorder)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <VerdictIcon className={cn("h-4 w-4", verdict.iconClass)} />
            Bench-Audit Pre-Flight
            <Badge
              variant="outline"
              className={cn("text-xs", verdict.badgeClass)}
            >
              {verdict.label}
            </Badge>
          </CardTitle>
          <a
            href="https://arxiv.org/abs/2605.26079"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            title="Anchor paper — ABA (Are Benchmarks Aware?)"
          >
            {audit.anchor}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-6">
          {/* Trust gauge */}
          <div className="relative h-44">
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart
                innerRadius="70%"
                outerRadius="100%"
                data={chartData}
                startAngle={90}
                endAngle={-270}
              >
                <PolarAngleAxis
                  type="number"
                  domain={[0, 100]}
                  angleAxisId={0}
                  tick={false}
                />
                <RadialBar background dataKey="value" cornerRadius={6} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <div className={cn("text-2xl font-semibold", verdict.iconClass)}>
                {trustPct}%
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                trust score
              </div>
            </div>
          </div>

          {/* Stats + hygiene-class scores */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <Stat label="Total tasks" value={audit.total_tasks} />
              <Stat
                label="Flagged tasks"
                value={audit.flagged_task_ids.length}
                tone={audit.flagged_task_ids.length > 0 ? "warn" : "ok"}
              />
              <Stat
                label="Flagged ratio"
                value={`${Math.round(audit.flagged_task_ratio * 100)}%`}
              />
              <Stat label="Audited" value={auditedAt} mono />
            </div>

            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Hygiene class scores
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(HYGIENE_CLASS_LABELS) as BenchHygieneClass[]).map(
                  (cls) => {
                    const score = audit.hygiene_class_scores[cls] ?? 1;
                    const pct = Math.round(score * 100);
                    return (
                      <div
                        key={cls}
                        className="flex items-center justify-between text-xs px-3 py-1.5 rounded border border-border/50 bg-background-secondary"
                      >
                        <span className="text-muted-foreground">
                          {HYGIENE_CLASS_LABELS[cls]}
                        </span>
                        <span
                          className={cn(
                            "font-medium",
                            score < minTrustScore
                              ? "text-red-400"
                              : score < allowAboveScore
                              ? "text-yellow-300"
                              : "text-green-400"
                          )}
                        >
                          {pct}%
                        </span>
                      </div>
                    );
                  }
                )}
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                Routing gate:{" "}
              </span>
              {verdict.gateExplanation(minTrustScore, allowAboveScore)}
            </div>
          </div>
        </div>

        {/* Flagged-task table */}
        {audit.task_flags.length > 0 && (
          <div className="mt-6">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              Hygiene flags ({audit.task_flags.length})
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Evidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {audit.task_flags.map((flag, idx) => (
                  <TableRow key={`${flag.task_id}-${idx}`}>
                    <TableCell className="font-mono text-xs">
                      {flag.task_id}
                    </TableCell>
                    <TableCell className="text-xs">
                      {HYGIENE_CLASS_LABELS[flag.hygiene_class]}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] uppercase",
                          SEVERITY_STYLES[flag.severity]
                        )}
                      >
                        {flag.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {flag.evidence}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface StatProps {
  label: string;
  value: string | number;
  tone?: "ok" | "warn";
  mono?: boolean;
}

function Stat({ label, value, tone, mono }: StatProps) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "text-sm font-medium",
          tone === "warn" && "text-yellow-300",
          tone === "ok" && "text-foreground",
          mono && "font-mono text-xs"
        )}
      >
        {value}
      </div>
    </div>
  );
}

interface TrustVerdict {
  label: string;
  icon: typeof ShieldCheck;
  iconClass: string;
  cardBorder: string;
  badgeClass: string;
  fill: string;
  gateExplanation: (min: number, allow: number) => string;
}

function classifyTrust(
  score: number,
  minTrustScore: number,
  allowAboveScore: number
): TrustVerdict {
  if (score >= allowAboveScore) {
    return {
      label: "Trusted",
      icon: ShieldCheck,
      iconClass: "text-green-400",
      cardBorder: "border-green-500/20",
      badgeClass: "border-green-500/30 text-green-400",
      fill: "#22c55e",
      gateExplanation: (_min, allow) =>
        `Above ${Math.round(allow * 100)}% — benchmark deltas may gate routing decisions.`,
    };
  }
  if (score >= minTrustScore) {
    return {
      label: "HITL band",
      icon: ShieldQuestion,
      iconClass: "text-yellow-300",
      cardBorder: "border-yellow-500/20",
      badgeClass: "border-yellow-500/30 text-yellow-300",
      fill: "#facc15",
      gateExplanation: (min, allow) =>
        `Between ${Math.round(min * 100)}% and ${Math.round(allow * 100)}% — routing requires human approval.`,
    };
  }
  return {
    label: "Low trust",
    icon: ShieldAlert,
    iconClass: "text-red-400",
    cardBorder: "border-red-500/30",
    badgeClass: "border-red-500/30 text-red-400",
    fill: "#ef4444",
    gateExplanation: (min) =>
      `Below ${Math.round(min * 100)}% — benchmark deltas cannot gate routing (denied).`,
  };
}
