"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp } from "lucide-react";
import type { Run, RunStatus } from "@/types/run";

interface RunVolumeChartProps {
  runs: Run[];
  isLoading?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  completed: "#22c55e",
  failed: "#ef4444",
  running: "#eab308",
  waiting_approval: "#a855f7",
  timeout: "#f97316",
  budget_killed: "#ef4444",
  policy_blocked: "#a855f7",
  cancelled: "#6b7280",
  queued: "#3b82f6",
  created: "#6b7280",
};

const STATUS_LABELS: Record<string, string> = {
  completed: "Completed",
  failed: "Failed",
  running: "Running",
  waiting_approval: "Waiting",
  timeout: "Timeout",
  budget_killed: "Budget",
  policy_blocked: "Blocked",
  cancelled: "Cancelled",
  queued: "Queued",
  created: "Created",
};

interface ChartDataPoint {
  date: string;
  [key: string]: number | string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const total = payload.reduce(
    (sum: number, entry: { value: number }) => sum + (Number(entry.value) || 0),
    0
  );

  return (
    <div className="bg-background-elevated border border-border rounded-lg shadow-lg p-3 min-w-[140px]">
      <p className="text-sm font-medium mb-2">{label}</p>
      <div className="space-y-1">
        {payload.map((entry: { name: string; value: number; color: string }, index: number) => (
          <div key={index} className="flex items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <div
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-muted-foreground">{entry.name}</span>
            </div>
            <span className="font-medium">{entry.value}</span>
          </div>
        ))}
        <div className="border-t border-border mt-2 pt-2 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Total</span>
          <span className="font-semibold">{total}</span>
        </div>
      </div>
    </div>
  );
}

export function RunVolumeChart({ runs, isLoading }: RunVolumeChartProps) {
  const { chartData, statuses } = useMemo(() => {
    // Get last 7 days
    const days: ChartDataPoint[] = [];
    const statusSet = new Set<string>();

    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });

      const dayData: ChartDataPoint = { date: dateStr };

      // Count runs for each status on this day
      runs.forEach((run) => {
        const runDate = new Date(run.created_at);
        const runDateStr = runDate.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });

        if (runDateStr === dateStr) {
          const status = run.status;
          statusSet.add(status);
          dayData[status] = ((dayData[status] as number) || 0) + 1;
        }
      });

      days.push(dayData);
    }

    // Sort statuses by priority (completed first, then running, then failed, etc.)
    const statusOrder: RunStatus[] = [
      "completed",
      "running",
      "waiting_approval",
      "queued",
      "created",
      "failed",
      "timeout",
      "budget_killed",
      "policy_blocked",
      "cancelled",
    ];

    const orderedStatuses = statusOrder.filter((s) => statusSet.has(s));

    return { chartData: days, statuses: orderedStatuses };
  }, [runs]);

  if (isLoading) {
    return (
      <Card className="bg-gradient-to-br from-background-secondary to-background border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-accent-blue" />
            Run Volume (7 Days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  const hasData = chartData.some((day) =>
    Object.keys(day).some((key) => key !== "date" && (day[key] as number) > 0)
  );

  if (!hasData) {
    return (
      <Card className="bg-gradient-to-br from-background-secondary to-background border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-accent-blue" />
            Run Volume (7 Days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
            No run data available for the last 7 days
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gradient-to-br from-background-secondary to-background border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-accent-blue" />
          Run Volume (7 Days)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64 w-full min-h-[256px]">
          <ResponsiveContainer width="100%" height="100%" minHeight={200} minWidth={200}>
            <BarChart
              data={chartData}
              margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
            >
              <XAxis
                dataKey="date"
                stroke="var(--foreground-muted)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--foreground-muted)" }}
              />
              <YAxis
                stroke="var(--foreground-muted)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--foreground-muted)" }}
                allowDecimals={false}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
              <Legend
                verticalAlign="bottom"
                height={36}
                formatter={(value) => (
                  <span style={{ color: "var(--foreground-secondary)", fontSize: 11 }}>
                    {STATUS_LABELS[value] || value}
                  </span>
                )}
              />
              {statuses.map((status) => (
                <Bar
                  key={status}
                  dataKey={status}
                  name={STATUS_LABELS[status] || status}
                  stackId="runs"
                  fill={STATUS_COLORS[status] || "#6b7280"}
                  radius={status === statuses[statuses.length - 1] ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
