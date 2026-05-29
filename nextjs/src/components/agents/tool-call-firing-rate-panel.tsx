"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, AlertTriangle, ChevronDown } from "lucide-react";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useToolCallFiringRate } from "@/hooks/use-tool-call-firing-rate";
import type { AgentFiringRateResponse } from "@/types/metrics";

interface ToolCallFiringRatePanelProps {
  agentId: string;
  /** Override the default 40% low-firing-rate threshold. */
  threshold?: number;
}

const THRESHOLD_OPTIONS = [0.2, 0.3, 0.4, 0.5, 0.6];
const WINDOW_OPTIONS = [6, 12, 24, 72, 168];
const DEFAULT_THRESHOLD = 0.4;
const DEFAULT_WINDOW_HOURS = 24;

/**
 * Tool-call firing-rate panel. Pulls the trend via TanStack Query, renders
 * a Recharts area chart with a threshold reference line, and flashes a
 * breach badge when the aggregate rate is below the configured floor.
 *
 * Anchor attribute: `ferrumdeck.metrics.tool_call_firing_rate` — the same
 * OTel span attribute key the worker / gateway tag on the run-completion
 * span. The dashboard cache and the trace exporter agree on one schema.
 */
export function ToolCallFiringRatePanel({
  agentId,
  threshold,
}: ToolCallFiringRatePanelProps) {
  const [windowHours, setWindowHours] = useState<number>(DEFAULT_WINDOW_HOURS);
  const [overrideThreshold, setOverrideThreshold] = useState<number>(
    threshold ?? DEFAULT_THRESHOLD
  );

  const { data, isLoading } = useToolCallFiringRate(agentId, {
    windowHours,
    threshold: overrideThreshold,
  });

  if (isLoading || !data) {
    return (
      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-72 mt-2" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  const aggregate = data.window;
  const breached = aggregate.low_firing_rate_breached;
  const ratePct = Math.round(aggregate.rate * 100);
  const thresholdPct = Math.round(aggregate.low_firing_rate_threshold * 100);

  return (
    <Card
      className={cn(
        "bg-card/50",
        breached ? "border-accent-red/40" : "border-border/50"
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-lg bg-background-secondary flex items-center justify-center shrink-0">
              <Activity
                className={cn(
                  "h-5 w-5",
                  breached ? "text-accent-red" : "text-accent-purple"
                )}
              />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base flex items-center gap-2">
                Tool-call firing rate
                {breached ? (
                  <Badge
                    variant="outline"
                    className="border-accent-red/40 text-accent-red text-xs gap-1"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    Low firing
                  </Badge>
                ) : null}
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">
                {aggregate.invoking_steps}/{aggregate.reasoning_steps} LLM
                steps invoked a tool over the last {windowHours}h.
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <WindowSelect value={windowHours} onChange={setWindowHours} />
            <ThresholdSelect
              value={overrideThreshold}
              onChange={setOverrideThreshold}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-baseline gap-3">
          <div
            className={cn(
              "text-3xl font-semibold tabular-nums",
              breached ? "text-accent-red" : "text-foreground"
            )}
          >
            {aggregate.reasoning_steps === 0 ? "—" : `${ratePct}%`}
          </div>
          <div className="text-xs text-muted-foreground">
            threshold {thresholdPct}%
          </div>
        </div>
        <TrendChart data={data} threshold={overrideThreshold} />
        {aggregate.reasoning_steps === 0 ? (
          <p className="text-xs text-muted-foreground">
            No reasoning steps recorded in this window — the metric will
            populate after the next completed run.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TrendChart({
  data,
  threshold,
}: {
  data: AgentFiringRateResponse;
  threshold: number;
}) {
  const chartData = useMemo(
    () =>
      data.points.map((p) => ({
        ts: shortTime(p.completed_at),
        rate: Math.round(p.rate * 100),
      })),
    [data.points]
  );

  if (chartData.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-xs text-muted-foreground border border-dashed border-border/40 rounded-md">
        No runs in window
      </div>
    );
  }

  return (
    <div className="h-32">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={chartData}
          margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient
              id="firingRateFill"
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor="#a855f7" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#a855f7" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(255,255,255,0.05)"
          />
          <XAxis
            dataKey="ts"
            tick={{ fontSize: 10, fill: "rgba(255,255,255,0.6)" }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: "rgba(255,255,255,0.6)" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v}%`}
            width={36}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "rgba(20,20,30,0.95)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 6,
              fontSize: 12,
            }}
            formatter={(value: number | undefined) => [
              `${value ?? 0}%`,
              "Firing rate",
            ]}
          />
          <ReferenceLine
            y={Math.round(threshold * 100)}
            stroke="#ef4444"
            strokeDasharray="4 4"
            label={{
              value: `${Math.round(threshold * 100)}% floor`,
              position: "right",
              fill: "#ef4444",
              fontSize: 10,
            }}
          />
          <Area
            type="monotone"
            dataKey="rate"
            stroke="#a855f7"
            strokeWidth={2}
            fill="url(#firingRateFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function shortTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return iso;
  }
}

function WindowSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="text-xs px-2 py-1 rounded border border-border/40 inline-flex items-center gap-1 hover:bg-background-secondary">
        {value}h
        <ChevronDown className="h-3 w-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {WINDOW_OPTIONS.map((opt) => (
          <DropdownMenuItem key={opt} onSelect={() => onChange(opt)}>
            {opt}h
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThresholdSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="text-xs px-2 py-1 rounded border border-border/40 inline-flex items-center gap-1 hover:bg-background-secondary">
        floor {Math.round(value * 100)}%
        <ChevronDown className="h-3 w-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {THRESHOLD_OPTIONS.map((opt) => (
          <DropdownMenuItem key={opt} onSelect={() => onChange(opt)}>
            {Math.round(opt * 100)}%
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
