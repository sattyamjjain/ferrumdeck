"use client";

import { useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChartIcon } from "lucide-react";
import type { Run, RunStatus } from "@/types/run";

const COLORS: Record<RunStatus, string> = {
  created: "#6e7681",
  queued: "#388bfd",
  running: "#d29922",
  waiting_approval: "#a371f7",
  completed: "#3fb950",
  failed: "#f85149",
  cancelled: "#6e7681",
  timeout: "#f85149",
  budget_killed: "#f85149",
  policy_blocked: "#a371f7",
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
  policy_blocked: "Blocked",
};

interface StatusDistributionChartProps {
  runs: Run[];
}

export function StatusDistributionChart({ runs }: StatusDistributionChartProps) {
  const chartData = useMemo(() => {
    const grouped = runs.reduce((acc, run) => {
      acc[run.status] = (acc[run.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(grouped).map(([status, value]) => ({
      name: STATUS_LABELS[status] || status,
      value,
      color: COLORS[status as RunStatus] || "#6e7681",
    }));
  }, [runs]);

  // Don't render chart if no data
  if (chartData.length === 0) {
    return (
      <Card className="bg-gradient-to-br from-background-secondary to-background border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <PieChartIcon className="h-4 w-4 text-accent-purple" />
            Status Distribution
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
            No status data available
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
          Status Distribution
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%" minWidth={200} minHeight={200}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="45%"
                innerRadius={50}
                outerRadius={70}
                paddingAngle={2}
                dataKey="value"
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--background-elevated)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                }}
                labelStyle={{ color: "var(--foreground)", fontWeight: 500 }}
              />
              <Legend
                verticalAlign="bottom"
                height={36}
                formatter={(value) => (
                  <span style={{ color: "var(--foreground-secondary)", fontSize: 11 }}>{value}</span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
