"use client";

import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign } from "lucide-react";
import type { Run } from "@/types/run";

interface CostChartProps {
  runs: Run[];
}

export function CostChart({ runs }: CostChartProps) {
  const chartData = useMemo(() => {
    // Group runs by day and sum costs
    const grouped = runs.reduce((acc, run) => {
      const date = new Date(run.created_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      acc[date] = (acc[date] || 0) + (run.cost_cents || 0);
      return acc;
    }, {} as Record<string, number>);

    // Convert to array and format for display
    return Object.entries(grouped)
      .map(([date, cents]) => ({
        date,
        cost: cents / 100, // Convert to dollars
      }))
      .slice(-14); // Last 14 days
  }, [runs]);

  // Don't render chart if no data
  if (chartData.length === 0) {
    return (
      <Card className="bg-gradient-to-br from-background-secondary to-background border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-accent-green" />
            Daily Cost
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
            No cost data available
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gradient-to-br from-background-secondary to-background border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-accent-green" />
          Daily Cost
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%" minWidth={200} minHeight={200}>
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
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
                tickFormatter={(value) => `$${value}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--background-elevated)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                }}
                labelStyle={{ color: "var(--foreground)", fontWeight: 500 }}
                formatter={(value) => [`$${Number(value).toFixed(2)}`, "Cost"]}
              />
              <Bar
                dataKey="cost"
                fill="var(--accent-green)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
