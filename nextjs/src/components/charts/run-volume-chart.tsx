"use client";

import { useMemo } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";
import type { Run } from "@/types/run";

interface RunVolumeChartProps {
  runs: Run[];
}

export function RunVolumeChart({ runs }: RunVolumeChartProps) {
  const chartData = useMemo(() => {
    // Group runs by day
    const grouped = runs.reduce((acc, run) => {
      const date = new Date(run.created_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      acc[date] = (acc[date] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Convert to array and sort
    return Object.entries(grouped)
      .map(([date, count]) => ({ date, count }))
      .slice(-14); // Last 14 days
  }, [runs]);

  // Don't render chart if no data
  if (chartData.length === 0) {
    return (
      <Card className="bg-gradient-to-br from-background-secondary to-background border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-accent-blue" />
            Run Volume
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
            No run data available
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
          Run Volume
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%" minWidth={200} minHeight={200}>
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--accent-blue)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--accent-blue)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                stroke="var(--foreground-muted)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--foreground-muted)' }}
              />
              <YAxis
                stroke="var(--foreground-muted)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--foreground-muted)' }}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--background-elevated)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                }}
                labelStyle={{ color: "var(--foreground)", fontWeight: 500 }}
                itemStyle={{ color: "var(--accent-blue)" }}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="var(--accent-blue)"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorCount)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
