"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Layers,
  Minus,
  PlusCircle,
  Settings2,
  Wrench,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  EvalRun,
  HarnessConfig,
  HarnessConfigDelta,
  ToolBinding,
} from "@/types/eval";

interface HarnessConfigPanelProps {
  evalRun: EvalRun;
}

/**
 * Surfaces the (model × harness_config) grouping the spec asks for.
 *
 * Renders a side-by-side bar chart of the per-harness aggregate score, plus
 * a per-dimension change list when a baseline harness is present and
 * different from the current one. Reuses the project's existing Recharts +
 * shadcn primitives; no new dependency, no new state store.
 *
 * Anchor: Harness-Bench — same model under different harness configs can
 * produce different fd-evals scores. The panel renders nothing when the run
 * has no harness configured, so legacy runs are unaffected.
 */
export function HarnessConfigPanel({ evalRun }: HarnessConfigPanelProps) {
  const harness = evalRun.harness_config;
  const baselineHarness = evalRun.baseline_harness_config;

  if (!harness && !baselineHarness) {
    // Nothing to show — keeps the legacy run-detail page byte-identical for
    // any run that predates this PR.
    return null;
  }

  const currentLabel = labelFor(evalRun.model, harness);
  const baselineLabel = labelFor(
    evalRun.model,
    baselineHarness ?? evalRun.harness_config,
  );
  const sharedHarness = evalRun.harness_diff?.shared_harness ?? false;
  const delta = evalRun.harness_diff?.delta ?? null;

  return (
    <Card className="bg-card/50 border-border/50">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-background-secondary flex items-center justify-center shrink-0">
              <Layers className="h-5 w-5 text-accent-purple" />
            </div>
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                Harness configuration
                {harness ? (
                  <Badge
                    variant="outline"
                    className="border-accent-purple/30 text-accent-purple text-xs"
                  >
                    {harness.anchor}
                  </Badge>
                ) : null}
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">
                fd-evals scores are reported at the (model × harness) level —
                same model, different harness can score differently.
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Group label badge row */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {baselineHarness && baselineHarness.harness_id !== harness?.harness_id ? (
            <>
              <Badge variant="outline" className="font-mono">
                {baselineLabel}
              </Badge>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
            </>
          ) : null}
          <Badge
            variant="outline"
            className={cn(
              "font-mono",
              sharedHarness
                ? "border-accent-green/30 text-accent-green"
                : "border-accent-purple/30 text-accent-purple",
            )}
          >
            {currentLabel}
          </Badge>
          {sharedHarness ? (
            <span className="text-muted-foreground flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              shared harness
            </span>
          ) : null}
        </div>

        {/* Score-by-group bar chart (only when we have both sides) */}
        {evalRun.baseline_score !== undefined && harness ? (
          <ScoreByGroupChart
            baselineLabel={baselineLabel}
            currentLabel={currentLabel}
            baselineScore={evalRun.baseline_score}
            currentScore={evalRun.score}
          />
        ) : null}

        {/* Dimension grid */}
        {harness ? <DimensionGrid harness={harness} /> : null}

        {/* Per-dimension diff (only when present + structurally different) */}
        {delta && !sharedHarness ? <DimensionDiff delta={delta} /> : null}
      </CardContent>
    </Card>
  );
}

function labelFor(model: string | undefined, harness: HarnessConfig | undefined): string {
  const m = model ?? "unknown-model";
  const h = harness?.label ?? "(no harness)";
  return `${m} × ${h}`;
}

interface ScoreByGroupChartProps {
  baselineLabel: string;
  currentLabel: string;
  baselineScore: number;
  currentScore: number;
}

function ScoreByGroupChart({
  baselineLabel,
  currentLabel,
  baselineScore,
  currentScore,
}: ScoreByGroupChartProps) {
  const data = useMemo(
    () => [
      {
        group: shorten(baselineLabel),
        full: baselineLabel,
        score: Math.round(baselineScore * 100),
      },
      {
        group: shorten(currentLabel),
        full: currentLabel,
        score: Math.round(currentScore * 100),
      },
    ],
    [baselineLabel, currentLabel, baselineScore, currentScore],
  );

  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        Score by (model × harness)
      </div>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.06)"
            />
            <XAxis
              dataKey="group"
              tick={{ fontSize: 10, fill: "rgba(255,255,255,0.7)" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={[0, 100]}
              tickFormatter={(v) => `${v}%`}
              tick={{ fontSize: 10, fill: "rgba(255,255,255,0.6)" }}
              axisLine={false}
              tickLine={false}
              width={36}
            />
            <Tooltip
              cursor={{ fill: "rgba(168, 85, 247, 0.08)" }}
              contentStyle={{
                backgroundColor: "rgba(20,20,30,0.95)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 6,
                fontSize: 12,
              }}
              formatter={(value: number | undefined) => [
                `${value ?? 0}%`,
                "Score",
              ]}
              labelFormatter={(label: string, payload) => {
                const full = payload?.[0]?.payload?.full as string | undefined;
                return full ?? label;
              }}
            />
            <Bar dataKey="score" fill="#a855f7" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function DimensionGrid({ harness }: { harness: HarnessConfig }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
      <DimensionCard
        icon={Settings2}
        label="Permission tier"
        value={harness.permission_tier}
      />
      <DimensionCard
        icon={Wrench}
        label="Tools available"
        value={`${harness.tools_available.length}`}
        subtitle={
          harness.tools_available
            .slice(0, 4)
            .map((t) => (t.version ? `${t.name}@${t.version}` : t.name))
            .join(", ") + (harness.tools_available.length > 4 ? "…" : "")
        }
      />
      <DimensionCard
        icon={Settings2}
        label="State / recovery"
        value={`${harness.state_recovery.on_error} · ${harness.state_recovery.max_retries} retries · ${harness.state_recovery.max_iterations} iter`}
      />
      <DimensionCard
        icon={Settings2}
        label="Tracing"
        value={`${harness.tracing.exporter} · sample ${Math.round(harness.tracing.sample_rate * 100)}%`}
        subtitle={
          harness.tracing.gen_ai_semconv_version
            ? `gen_ai semconv ${harness.tracing.gen_ai_semconv_version}`
            : undefined
        }
      />
    </div>
  );
}

function DimensionCard({
  icon: Icon,
  label,
  value,
  subtitle,
}: {
  icon: typeof Settings2;
  label: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-md border border-border/50 bg-background-secondary px-3 py-2 space-y-0.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="text-foreground font-medium">{value}</div>
      {subtitle ? (
        <div className="text-muted-foreground text-[11px] truncate">{subtitle}</div>
      ) : null}
    </div>
  );
}

function DimensionDiff({ delta }: { delta: HarnessConfigDelta }) {
  const hasChange =
    delta.permission_tier_changed ||
    delta.added_tools.length > 0 ||
    delta.removed_tools.length > 0 ||
    delta.version_changed_tools.length > 0 ||
    delta.state_recovery_changed ||
    delta.tracing_changed;

  if (!hasChange) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <AlertTriangle className="h-3 w-3 text-accent-yellow" />
        Per-dimension changes
      </div>
      <ul className="space-y-1 text-xs">
        {delta.permission_tier_changed ? (
          <DiffRow icon={Settings2} text="Permission tier changed" tone="warn" />
        ) : null}
        {delta.state_recovery_changed ? (
          <DiffRow icon={Settings2} text="State / recovery settings changed" tone="warn" />
        ) : null}
        {delta.tracing_changed ? (
          <DiffRow icon={Settings2} text="Tracing config changed" tone="warn" />
        ) : null}
        {delta.added_tools.map((t) => (
          <DiffRow
            key={`added-${t.name}`}
            icon={PlusCircle}
            text={`Tool added: ${formatTool(t)}`}
            tone="add"
          />
        ))}
        {delta.removed_tools.map((t) => (
          <DiffRow
            key={`removed-${t.name}`}
            icon={Minus}
            text={`Tool removed: ${formatTool(t)}`}
            tone="remove"
          />
        ))}
        {delta.version_changed_tools.map(({ baseline, current }) => (
          <DiffRow
            key={`ver-${baseline.name}`}
            icon={ArrowRight}
            text={`${baseline.name}: ${baseline.version ?? "—"} → ${current.version ?? "—"}`}
            tone="warn"
          />
        ))}
      </ul>
    </div>
  );
}

function DiffRow({
  icon: Icon,
  text,
  tone,
}: {
  icon: typeof Settings2;
  text: string;
  tone: "warn" | "add" | "remove";
}) {
  const toneClass =
    tone === "add"
      ? "text-accent-green"
      : tone === "remove"
        ? "text-accent-red"
        : "text-accent-yellow";
  return (
    <li className="flex items-center gap-2">
      <Icon className={cn("h-3 w-3", toneClass)} />
      <span className="text-foreground">{text}</span>
    </li>
  );
}

function formatTool(t: ToolBinding): string {
  return t.version ? `${t.name}@${t.version}` : t.name;
}

function shorten(label: string): string {
  // X-axis labels are tight; keep the harness side intact (it's the
  // distinguishing dimension) and clip the model side if it's long.
  const [model, ...rest] = label.split(" × ");
  const harness = rest.join(" × ");
  const m = model.length > 14 ? `${model.slice(0, 13)}…` : model;
  return `${m}\n× ${harness}`;
}
