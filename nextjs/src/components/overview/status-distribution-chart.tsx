"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PieChartIcon } from "lucide-react";
import type { Run, RunStatus } from "@/types/run";

interface StatusDistributionChartProps {
  runs: Run[];
  isLoading?: boolean;
}

const STATUS_COLORS: Record<RunStatus, string> = {
  created: "#6b7280",
  queued: "#3b82f6",
  running: "#eab308",
  waiting_approval: "#a855f7",
  completed: "#22c55e",
  failed: "#ef4444",
  cancelled: "#6b7280",
  timeout: "#f97316",
  budget_killed: "#ef4444",
  policy_blocked: "#a855f7",
};

const STATUS_LABELS: Record<string, string> = {
  created: "Created",
  queued: "Queued",
  running: "Running",
  waiting_approval: "Waiting",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  timeout: "Timeout",
  budget_killed: "Budget Killed",
  policy_blocked: "Policy Blocked",
};

interface ChartDataPoint {
  name: string;
  value: number;
  color: string;
  status: string;
  total?: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: ChartDataPoint }>;
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const data = payload[0].payload;
  const total = (payload[0].payload as { total?: number }).total || 0;
  const percentage = total > 0 ? ((data.value / total) * 100).toFixed(1) : 0;

  return (
    <div className="bg-background-elevated border border-border rounded-lg shadow-lg p-3 min-w-[120px]">
      <div className="flex items-center gap-2 mb-1">
        <div
          className="h-3 w-3 rounded-full"
          style={{ backgroundColor: data.color }}
        />
        <span className="font-medium text-sm">{data.name}</span>
      </div>
      <div className="text-xs text-muted-foreground">
        {data.value} runs ({percentage}%)
      </div>
    </div>
  );
}

export function StatusDistributionChart({
  runs,
  isLoading,
}: StatusDistributionChartProps) {
  const router = useRouter();

  // Filter runs from last 24 hours
  const { chartData, total } = useMemo(() => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const recentRuns = runs.filter(
      (run) => new Date(run.created_at) >= yesterday
    );

    const grouped = recentRuns.reduce((acc, run) => {
      acc[run.status] = (acc[run.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const total = Object.values(grouped).reduce((sum, count) => sum + count, 0);

    const data = Object.entries(grouped)
      .map(([status, value]) => ({
        name: STATUS_LABELS[status] || status,
        value,
        color: STATUS_COLORS[status as RunStatus] || "#6b7280",
        status,
        total,
      }))
      .sort((a, b) => b.value - a.value);

    return { chartData: data, total };
  }, [runs]);

  const handleClick = (data: ChartDataPoint) => {
    router.push(`/runs?status=${data.status}`);
  };

  if (isLoading) {
    return (
      <Card className="bg-gradient-to-br from-background-secondary to-background border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <PieChartIcon className="h-4 w-4 text-accent-purple" />
            Status Distribution (24h)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (chartData.length === 0) {
    return (
      <Card className="bg-gradient-to-br from-background-secondary to-background border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <PieChartIcon className="h-4 w-4 text-accent-purple" />
            Status Distribution (24h)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
            No run data in the last 24 hours
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gradient-to-br from-background-secondary to-background border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <PieChartIcon className="h-4 w-4 text-accent-purple" />
          Status Distribution (24h)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64 w-full flex min-h-[256px]">
          {/* Chart */}
          <div className="flex-1 relative min-w-0">
            <ResponsiveContainer width="100%" height="100%" minHeight={200} minWidth={150}>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                  onClick={(_, index) => handleClick(chartData[index])}
                  className="cursor-pointer"
                  stroke="none"
                >
                  {chartData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.color}
                      className="hover:opacity-80 transition-opacity"
                    />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            {/* Center text */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <p className="text-2xl font-bold">{total}</p>
                <p className="text-xs text-muted-foreground">runs</p>
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="w-32 flex flex-col justify-center space-y-2 ml-2">
            {chartData.slice(0, 5).map((entry) => (
              <button
                key={entry.status}
                onClick={() => handleClick(entry)}
                className="flex items-center gap-2 text-xs hover:bg-accent/50 rounded px-2 py-1 transition-colors text-left group"
              >
                <div
                  className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="text-muted-foreground group-hover:text-foreground truncate">
                  {entry.name}
                </span>
                <span className="text-foreground font-medium ml-auto">
                  {entry.value}
                </span>
              </button>
            ))}
            {chartData.length > 5 && (
              <div className="text-xs text-muted-foreground px-2">
                +{chartData.length - 5} more
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
