"use client";

import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign } from "lucide-react";
import type { Run } from "@/types/run";

interface CostChartProps {
  runs: Run[];
}

const ACTIVE_STATUSES: ReadonlySet<string> = new Set([
  "created",
  "queued",
  "running",
  "waiting_approval",
]);

function isoDateKey(value: string): string {
  // Same shape we render on the X axis so the keys align.
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function CostChart({ runs }: CostChartProps) {
  const chartData = useMemo(() => {
    // Group actual cost by day.
    const grouped = runs.reduce((acc, run) => {
      const date = isoDateKey(run.created_at);
      acc[date] = (acc[date] || 0) + (run.cost_cents || 0);
      return acc;
    }, {} as Record<string, number>);

    // Projected-additional cost from currently-active runs that the gateway
    // has flagged as on track to breach. Apportioned to their created_at day —
    // the dashboard treats the forecast as "what the run will end up costing
    // in addition to what it has already burned".
    const projectedExtra = runs.reduce((acc, run) => {
      if (
        !ACTIVE_STATUSES.has(run.status) ||
        !run.budget_breach_projected ||
        run.projected_cost_cents === undefined
      ) {
        return acc;
      }
      const date = isoDateKey(run.created_at);
      const extra = Math.max(0, run.projected_cost_cents - (run.cost_cents || 0));
      acc[date] = (acc[date] || 0) + extra;
      return acc;
    }, {} as Record<string, number>);

    // Convert to array and format for display
    return Object.entries(grouped)
      .map(([date, cents]) => ({
        date,
        cost: cents / 100,
        projected: (projectedExtra[date] || 0) / 100,
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
        <div className="h-64 w-full min-h-[256px]">
          <ResponsiveContainer width="100%" height="100%" minWidth={200} minHeight={200} aspect={undefined}>
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
                formatter={(value, name) => [
                  `$${Number(value).toFixed(2)}`,
                  name === "projected" ? "Projected to add" : "Actual",
                ]}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: "var(--foreground-muted)" }} />
              <Bar
                dataKey="cost"
                name="Actual"
                stackId="cost"
                fill="var(--accent-green)"
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="projected"
                name="Projected (active runs)"
                stackId="cost"
                fill="var(--accent-yellow)"
                fillOpacity={0.55}
                stroke="var(--accent-yellow)"
                strokeDasharray="4 2"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
