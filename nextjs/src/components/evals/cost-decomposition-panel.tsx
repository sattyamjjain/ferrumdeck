"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertCircle, Receipt, Scale } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
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
import type { CostBreakdown, EvalRun, EvalTaskResult } from "@/types/eval";

interface CostDecompositionPanelProps {
  evalRun: EvalRun;
}

const TAX_DOMINANCE_THRESHOLD = 0.5;

/**
 * Surfaces the §2605.27320 debt-vs-tax cost decomposition:
 *
 * - Top: the run-level breakdown (token vs tax) + tax-share percentage.
 * - Middle: per-task stacked-bar Recharts chart ranked by `tax_share` desc.
 * - Bottom: a sortable table listing every task with its tax-share, so a
 *   user can see *which* decisions are tax-heavy.
 *
 * Renders `null` when neither the run nor any task carries a breakdown,
 * keeping legacy runs byte-identical. The panel is purely a *read* of the
 * data fd-evals already emits — no recomputation, no new fetch.
 */
export function CostDecompositionPanel({ evalRun }: CostDecompositionPanelProps) {
  const runBreakdown = evalRun.cost_breakdown;
  const taskRows = useMemo(() => buildTaskRows(evalRun.task_results), [
    evalRun.task_results,
  ]);

  if (!runBreakdown && taskRows.length === 0) {
    return null;
  }

  return (
    <Card className="bg-card/50 border-border/50">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-background-secondary flex items-center justify-center shrink-0">
              <Receipt className="h-5 w-5 text-accent-purple" />
            </div>
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                Cost decomposition
                {runBreakdown ? (
                  <Badge
                    variant="outline"
                    className="border-accent-purple/30 text-accent-purple text-xs"
                  >
                    {runBreakdown.anchor}
                  </Badge>
                ) : null}
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">
                <span className="font-medium text-foreground">debt</span> ={" "}
                primary calls that move tasks forward;{" "}
                <span className="font-medium text-foreground">tax</span> ={" "}
                retry / judge / guardrail / escalation / revalidation /
                monitor calls.
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {runBreakdown ? <RunSummary breakdown={runBreakdown} /> : null}
        {taskRows.length > 0 ? <PerTaskChart rows={taskRows} /> : null}
        {taskRows.length > 0 ? <PerTaskTable rows={taskRows} /> : null}
      </CardContent>
    </Card>
  );
}

function RunSummary({ breakdown }: { breakdown: CostBreakdown }) {
  const taxPct = Math.round(breakdown.tax_share * 100);
  const dominant = breakdown.is_tax_dominant;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <SummaryCard
        label="Token (debt)"
        value={formatCostCents(breakdown.token_cost_cents)}
        accent="text-accent-green"
      />
      <SummaryCard
        label="Tax"
        value={formatCostCents(breakdown.tax_cost_cents)}
        accent={dominant ? "text-accent-red" : "text-accent-yellow"}
      />
      <SummaryCard
        label="Tax share"
        value={`${taxPct}%`}
        accent={dominant ? "text-accent-red" : "text-foreground"}
        subtitle={
          dominant ? "tax-dominant run — investigate retry / escalation storms" : undefined
        }
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent,
  subtitle,
}: {
  label: string;
  value: string;
  accent: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-md border border-border/50 bg-background-secondary px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={cn("text-lg font-semibold mt-0.5", accent)}>{value}</div>
      {subtitle ? (
        <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}

interface RankedRow {
  task_id: string;
  task_name: string;
  token_cost_cents: number;
  tax_cost_cents: number;
  tax_share: number;
  is_tax_dominant: boolean;
}

function buildTaskRows(tasks: EvalTaskResult[]): RankedRow[] {
  const rows: RankedRow[] = tasks
    .filter((t): t is EvalTaskResult & { cost_breakdown: CostBreakdown } =>
      Boolean(t.cost_breakdown),
    )
    .map((t) => ({
      task_id: t.task_id,
      task_name: t.task_name,
      token_cost_cents: t.cost_breakdown.token_cost_cents,
      tax_cost_cents: t.cost_breakdown.tax_cost_cents,
      tax_share: t.cost_breakdown.tax_share,
      is_tax_dominant: t.cost_breakdown.is_tax_dominant,
    }));
  // Descending by tax_share; ties broken on task_id for stability.
  rows.sort(
    (a, b) =>
      b.tax_share - a.tax_share || a.task_id.localeCompare(b.task_id),
  );
  return rows;
}

function PerTaskChart({ rows }: { rows: RankedRow[] }) {
  // Cap to the top 10 tax-dominant tasks so the chart stays legible on
  // wide runs; the table below still lists every task.
  const data = rows.slice(0, 10).map((r) => ({
    task: shorten(r.task_name),
    full: r.task_name,
    token: roundCost(r.token_cost_cents),
    tax: roundCost(r.tax_cost_cents),
    tax_share: r.tax_share,
  }));

  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
        <Scale className="h-3 w-3" />
        Top tasks by tax-share (descending)
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 32 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.06)"
            />
            <XAxis
              dataKey="task"
              tick={{ fontSize: 10, fill: "rgba(255,255,255,0.6)" }}
              axisLine={false}
              tickLine={false}
              angle={-25}
              textAnchor="end"
              interval={0}
              height={48}
            />
            <YAxis
              tickFormatter={(v) => `${(v as number).toFixed(3)}¢`}
              tick={{ fontSize: 10, fill: "rgba(255,255,255,0.6)" }}
              axisLine={false}
              tickLine={false}
              width={56}
            />
            <Tooltip
              cursor={{ fill: "rgba(168, 85, 247, 0.08)" }}
              contentStyle={{
                backgroundColor: "rgba(20,20,30,0.95)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 6,
                fontSize: 12,
              }}
              formatter={(value: number | undefined, name: string | undefined) => [
                `${(value ?? 0).toFixed(4)}¢`,
                name === "token" ? "Token (debt)" : "Tax",
              ]}
              labelFormatter={(label: string, payload) => {
                const full = payload?.[0]?.payload?.full as string | undefined;
                const taxShare = payload?.[0]?.payload?.tax_share as
                  | number
                  | undefined;
                if (full === undefined || taxShare === undefined) return label;
                return `${full} — tax ${Math.round(taxShare * 100)}%`;
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              iconType="square"
              formatter={(value) => (value === "token" ? "Token (debt)" : "Tax")}
            />
            <Bar dataKey="token" stackId="cost" fill="#22c55e">
              {data.map((d, i) => (
                <Cell key={`token-${i}`} fillOpacity={d.tax_share > TAX_DOMINANCE_THRESHOLD ? 0.5 : 1} />
              ))}
            </Bar>
            <Bar dataKey="tax" stackId="cost" fill="#ef4444">
              {data.map((d, i) => (
                <Cell key={`tax-${i}`} fillOpacity={d.tax_share > TAX_DOMINANCE_THRESHOLD ? 1 : 0.7} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function PerTaskTable({ rows }: { rows: RankedRow[] }) {
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        Per-task breakdown ({rows.length})
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Task</TableHead>
            <TableHead className="text-right">Token (debt)</TableHead>
            <TableHead className="text-right">Tax</TableHead>
            <TableHead className="text-right">Tax share</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.task_id}>
              <TableCell className="font-mono text-xs">
                <div className="flex items-center gap-2">
                  <span className="truncate max-w-[28ch]" title={r.task_name}>
                    {r.task_name}
                  </span>
                  {r.is_tax_dominant ? (
                    <Badge
                      variant="outline"
                      className="border-accent-red/40 text-accent-red text-[10px] uppercase"
                    >
                      tax-heavy
                    </Badge>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCostCents(r.token_cost_cents)}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right tabular-nums",
                  r.is_tax_dominant && "text-accent-red",
                )}
              >
                {formatCostCents(r.tax_cost_cents)}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right tabular-nums",
                  r.is_tax_dominant ? "text-accent-red" : "text-foreground",
                )}
              >
                {`${Math.round(r.tax_share * 100)}%`}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function formatCostCents(cents: number): string {
  // Per-task costs are sub-cent; show four decimals so a $0.0010 primary
  // call doesn't render as "0.00¢".
  return `${cents.toFixed(4)}¢`;
}

function roundCost(cents: number): number {
  return Math.round(cents * 10000) / 10000;
}

function shorten(label: string): string {
  if (label.length <= 22) return label;
  return `${label.slice(0, 21)}…`;
}
