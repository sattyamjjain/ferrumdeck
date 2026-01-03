"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatNumber } from "@/lib/utils";
import type { ToolUsageStats, ToolCallsByDay } from "@/types/tool";

interface ToolUsageChartProps {
  data: ToolCallsByDay[];
}

export function ToolUsageChart({ data }: ToolUsageChartProps) {
  // Format data for recharts
  const chartData = data.map((item) => ({
    date: new Date(item.date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    success: item.success_count,
    error: item.error_count,
    total: item.count,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Calls Over Time</CardTitle>
        <CardDescription>Daily tool calls for the last 30 days</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] min-h-[300px]">
          <ResponsiveContainer width="100%" height="100%" minWidth={200} minHeight={200}>
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                axisLine={{ stroke: "hsl(var(--border))" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                axisLine={{ stroke: "hsl(var(--border))" }}
                tickLine={false}
                tickFormatter={(value) => formatNumber(value)}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.3)",
                }}
                labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 500 }}
                itemStyle={{ color: "hsl(var(--muted-foreground))" }}
              />
              <Legend
                wrapperStyle={{ paddingTop: 20 }}
                formatter={(value) => (
                  <span style={{ color: "hsl(var(--muted-foreground))", fontSize: 12 }}>
                    {value.charAt(0).toUpperCase() + value.slice(1)}
                  </span>
                )}
              />
              <Bar
                dataKey="success"
                stackId="a"
                fill="hsl(var(--accent-green))"
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="error"
                stackId="a"
                fill="hsl(var(--accent-red))"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

interface UsageStatsCardsProps {
  stats: ToolUsageStats;
}

export function UsageStatsCards({ stats }: UsageStatsCardsProps) {
  const errorRatePercentage = (stats.error_rate * 100).toFixed(1);
  const isHighErrorRate = stats.error_rate > 0.05; // > 5%

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <Card>
        <CardContent className="pt-6">
          <div className="text-2xl font-bold">{formatNumber(stats.total_calls)}</div>
          <p className="text-xs text-muted-foreground mt-1">Total Calls</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="text-2xl font-bold">{formatNumber(stats.calls_last_24h)}</div>
          <p className="text-xs text-muted-foreground mt-1">Last 24 Hours</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="text-2xl font-bold">{stats.avg_latency_ms.toFixed(0)}ms</div>
          <p className="text-xs text-muted-foreground mt-1">Avg Latency</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className={cn(
            "text-2xl font-bold",
            isHighErrorRate ? "text-accent-red" : "text-accent-green"
          )}>
            {errorRatePercentage}%
          </div>
          <p className="text-xs text-muted-foreground mt-1">Error Rate</p>
        </CardContent>
      </Card>
    </div>
  );
}
