"use client";

import { useMemo, useRef, useEffect, useState } from "react";
import {
  Brain,
  Wrench,
  Database,
  User,
  Shield,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from "lucide-react";
import { cn, formatDuration } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Step, StepType, StepStatus } from "@/types/run";

// Step type configuration with enhanced visuals
const stepTypeConfig: Record<
  StepType,
  {
    icon: typeof Brain;
    label: string;
    color: string;
    bgColor: string;
    glowColor: string;
    gradient: string;
  }
> = {
  llm: {
    icon: Brain,
    label: "LLM",
    color: "text-purple-400",
    bgColor: "bg-purple-500",
    glowColor: "rgba(168, 85, 247, 0.4)",
    gradient: "from-purple-500 to-purple-600",
  },
  tool: {
    icon: Wrench,
    label: "Tool",
    color: "text-blue-400",
    bgColor: "bg-blue-500",
    glowColor: "rgba(59, 130, 246, 0.4)",
    gradient: "from-blue-500 to-blue-600",
  },
  retrieval: {
    icon: Database,
    label: "Retrieval",
    color: "text-cyan-400",
    bgColor: "bg-cyan-500",
    glowColor: "rgba(6, 182, 212, 0.4)",
    gradient: "from-cyan-500 to-cyan-600",
  },
  human: {
    icon: User,
    label: "Human",
    color: "text-orange-400",
    bgColor: "bg-orange-500",
    glowColor: "rgba(251, 146, 60, 0.4)",
    gradient: "from-orange-500 to-orange-600",
  },
  approval: {
    icon: Shield,
    label: "Approval",
    color: "text-yellow-400",
    bgColor: "bg-yellow-500",
    glowColor: "rgba(234, 179, 8, 0.4)",
    gradient: "from-yellow-500 to-yellow-600",
  },
};

const stepStatusConfig: Record<
  StepStatus,
  { icon: typeof CheckCircle; color: string; bgColor: string }
> = {
  pending: { icon: Clock, color: "text-foreground-muted", bgColor: "bg-secondary" },
  running: { icon: Loader2, color: "text-yellow-400", bgColor: "bg-yellow-500" },
  waiting_approval: { icon: Shield, color: "text-amber-400", bgColor: "bg-amber-500" },
  completed: { icon: CheckCircle, color: "text-green-400", bgColor: "bg-green-500" },
  failed: { icon: XCircle, color: "text-red-400", bgColor: "bg-red-500" },
  skipped: { icon: Clock, color: "text-foreground-muted", bgColor: "bg-secondary" },
};

interface TraceWaterfallProps {
  steps: Step[];
  selectedStepId?: string;
  onSelectStep: (stepId: string) => void;
  runStartTime?: string;
  runEndTime?: string;
}

export function TraceWaterfall({
  steps,
  selectedStepId,
  onSelectStep,
  runStartTime,
  runEndTime,
}: TraceWaterfallProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);
  const [zoomLevel, setZoomLevel] = useState(1);

  // Sort steps by start time
  const sortedSteps = useMemo(() => {
    return [...steps].sort((a, b) => {
      const aTime = a.started_at || a.created_at;
      const bTime = b.started_at || b.created_at;
      return new Date(aTime).getTime() - new Date(bTime).getTime();
    });
  }, [steps]);

  // State for current time (for running steps)
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  // Update current time for running steps
  useEffect(() => {
    const hasRunningStep = sortedSteps.some((s) => s.status === "running");
    if (hasRunningStep) {
      const interval = setInterval(() => setCurrentTime(Date.now()), 100);
      return () => clearInterval(interval);
    }
  }, [sortedSteps]);

  // Calculate time bounds for the waterfall
  const { minTime, totalDuration } = useMemo(() => {
    if (sortedSteps.length === 0) {
      return { minTime: 0, totalDuration: 0 };
    }

    const startTimes = sortedSteps.map((s) =>
      new Date(s.started_at || s.created_at).getTime()
    );
    const endTimes = sortedSteps.map((s) =>
      s.completed_at
        ? new Date(s.completed_at).getTime()
        : s.status === "running"
        ? currentTime
        : new Date(s.started_at || s.created_at).getTime()
    );

    const min = runStartTime
      ? new Date(runStartTime).getTime()
      : Math.min(...startTimes);
    const max = runEndTime
      ? new Date(runEndTime).getTime()
      : Math.max(...endTimes, currentTime);

    return {
      minTime: min,
      totalDuration: Math.max(max - min, 1),
    };
  }, [sortedSteps, runStartTime, runEndTime, currentTime]);

  // Scroll selected step into view
  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest",
      });
    }
  }, [selectedStepId]);

  // Time scale markers
  const timeMarkers = useMemo(() => {
    if (totalDuration === 0) return [];
    const markers: { time: number; position: number }[] = [];
    const numMarkers = 6;
    for (let i = 0; i <= numMarkers; i++) {
      const position = i / numMarkers;
      markers.push({
        time: minTime + totalDuration * position,
        position: position * 100,
      });
    }
    return markers;
  }, [minTime, totalDuration]);

  if (sortedSteps.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-background-secondary/30 h-32 flex items-center justify-center">
        <div className="text-center text-foreground-muted">
          <Clock className="h-6 w-6 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Waiting for steps...</p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="rounded-xl border border-border bg-background-secondary/30 overflow-hidden animate-fade-in">
        {/* Header with controls */}
        <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-border bg-background-tertiary/50">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-medium text-foreground">Trace Waterfall</h3>
            <span className="text-xs text-foreground-muted">
              {sortedSteps.length} step{sortedSteps.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setZoomLevel(Math.max(0.5, zoomLevel - 0.25))}
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs text-foreground-muted w-12 text-center tabular-nums">
              {Math.round(zoomLevel * 100)}%
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setZoomLevel(Math.min(2, zoomLevel + 0.25))}
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 ml-1"
              onClick={() => setZoomLevel(1)}
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Time scale */}
        <div className="relative h-8 border-b border-border/50 bg-background-tertiary/30">
          <div className="absolute inset-0 flex items-center px-4">
            <div className="w-40 shrink-0" />
            <div className="flex-1 relative">
              {timeMarkers.map((marker, i) => (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 flex flex-col items-center"
                  style={{ left: `${marker.position}%`, transform: "translateX(-50%)" }}
                >
                  <div className="h-2 w-px bg-border" />
                  <span className="text-[10px] font-mono text-foreground-muted mt-0.5">
                    {formatDuration(marker.time - minTime)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Waterfall rows */}
        <div
          ref={containerRef}
          className="overflow-x-auto overflow-y-auto"
          style={{ maxHeight: "280px" }}
        >
          <div
            className="min-w-[700px]"
            style={{ width: `${100 * zoomLevel}%` }}
          >
            {sortedSteps.map((step, index) => (
              <WaterfallRow
                key={step.id}
                step={step}
                index={index}
                isSelected={step.id === selectedStepId}
                isLast={index === sortedSteps.length - 1}
                minTime={minTime}
                totalDuration={totalDuration}
                currentTime={currentTime}
                onSelect={() => onSelectStep(step.id)}
                selectedRef={step.id === selectedStepId ? selectedRef : undefined}
              />
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-between gap-4 px-4 py-2.5 border-t border-border bg-background-tertiary/30">
          <div className="flex items-center gap-4 text-xs text-foreground-muted">
            {Object.entries(stepTypeConfig).map(([type, config]) => (
              <div key={type} className="flex items-center gap-1.5">
                <div
                  className={cn(
                    "w-3 h-1.5 rounded-sm bg-gradient-to-r",
                    config.gradient
                  )}
                />
                <span>{config.label}</span>
              </div>
            ))}
          </div>
          <div className="text-xs text-foreground-muted font-mono">
            Total: {formatDuration(totalDuration)}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

// Individual waterfall row
interface WaterfallRowProps {
  step: Step;
  index: number;
  isSelected: boolean;
  isLast: boolean;
  minTime: number;
  totalDuration: number;
  currentTime: number;
  onSelect: () => void;
  selectedRef?: React.RefObject<HTMLDivElement | null>;
}

function WaterfallRow({
  step,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  index,
  isSelected,
  isLast,
  minTime,
  totalDuration,
  currentTime,
  onSelect,
  selectedRef,
}: WaterfallRowProps) {
  const typeConfig = stepTypeConfig[step.step_type] || stepTypeConfig.tool;
  const statusConfig = stepStatusConfig[step.status] || stepStatusConfig.pending;
  const TypeIcon = typeConfig.icon;
  const StatusIcon = statusConfig.icon;

  const stepStart = new Date(step.started_at || step.created_at).getTime();
  const stepEnd = step.completed_at
    ? new Date(step.completed_at).getTime()
    : step.status === "running"
    ? currentTime
    : stepStart;

  const isRunning = step.status === "running";
  const duration = stepEnd - stepStart;

  // Calculate position and width with safety bounds
  const left = Math.max(0, ((stepStart - minTime) / totalDuration) * 100);
  const rawWidth = (duration / totalDuration) * 100;
  const width = Math.max(rawWidth, 0.5); // Minimum visible width

  return (
    <div
      ref={selectedRef as React.RefObject<HTMLDivElement>}
      className={cn(
        "group flex items-center h-10 px-4 cursor-pointer transition-all duration-150",
        !isLast && "border-b border-border/30",
        isSelected
          ? "bg-accent-primary/8"
          : "hover:bg-background-tertiary/50"
      )}
      onClick={onSelect}
    >
      {/* Step label */}
      <div className="w-40 shrink-0 flex items-center gap-2.5 pr-4">
        <div
          className={cn(
            "flex items-center justify-center w-6 h-6 rounded-md transition-all",
            isSelected ? "scale-110" : "group-hover:scale-105",
            `bg-gradient-to-br ${typeConfig.gradient}`
          )}
          style={{
            boxShadow: isSelected ? `0 0 12px ${typeConfig.glowColor}` : undefined,
          }}
        >
          <TypeIcon className="h-3 w-3 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-xs font-medium text-foreground truncate block">
            {step.tool_name || step.model || typeConfig.label}
          </span>
          {step.step_number && (
            <span className="text-[10px] text-foreground-muted font-mono">
              #{step.step_number}
            </span>
          )}
        </div>
      </div>

      {/* Timeline bar container */}
      <div className="flex-1 relative h-full flex items-center">
        {/* Grid lines */}
        <div className="absolute inset-0 flex">
          {[0, 20, 40, 60, 80, 100].map((pos) => (
            <div
              key={pos}
              className="absolute top-0 bottom-0 w-px bg-border/20"
              style={{ left: `${pos}%` }}
            />
          ))}
        </div>

        {/* The actual bar */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={cn(
                "absolute h-5 rounded-md transition-all duration-200 cursor-pointer",
                "bg-gradient-to-r",
                typeConfig.gradient,
                isRunning && "animate-pulse",
                isSelected && "ring-2 ring-white/30 ring-offset-1 ring-offset-background"
              )}
              style={{
                left: `${left}%`,
                width: `${width}%`,
                opacity: step.status === "pending" ? 0.4 : 0.9,
                boxShadow: isSelected
                  ? `0 2px 12px ${typeConfig.glowColor}`
                  : `0 1px 4px rgba(0,0,0,0.2)`,
              }}
            >
              {/* Shine effect */}
              <div className="absolute inset-0 rounded-md overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent h-1/2" />
              </div>

              {/* Duration label (only if bar is wide enough) */}
              {width > 5 && (
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono text-white font-medium">
                  {formatDuration(duration)}
                </span>
              )}

              {/* Status indicator */}
              <div
                className={cn(
                  "absolute -right-1.5 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full flex items-center justify-center",
                  "border-2 border-background shadow-md",
                  statusConfig.bgColor
                )}
              >
                <StatusIcon
                  className={cn(
                    "h-2 w-2 text-white",
                    isRunning && "animate-spin"
                  )}
                />
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <StepTooltip step={step} typeConfig={typeConfig} duration={duration} />
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

// Tooltip content for step details
function StepTooltip({
  step,
  typeConfig,
  duration,
}: {
  step: Step;
  typeConfig: (typeof stepTypeConfig)[StepType];
  duration: number;
}) {
  const TypeIcon = typeConfig.icon;

  return (
    <div className="space-y-2 py-1">
      <div className="flex items-center gap-2">
        <div className={cn("p-1 rounded", `bg-gradient-to-br ${typeConfig.gradient}`)}>
          <TypeIcon className="h-3 w-3 text-white" />
        </div>
        <span className="font-medium">
          {step.tool_name || step.model || typeConfig.label}
        </span>
        {step.step_number && (
          <span className="text-xs text-foreground-muted font-mono">
            #{step.step_number}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div className="text-foreground-muted">Status</div>
        <div className="font-medium capitalize">{step.status.replace("_", " ")}</div>

        <div className="text-foreground-muted">Duration</div>
        <div className="font-mono">{formatDuration(duration)}</div>

        {step.input_tokens && (
          <>
            <div className="text-foreground-muted">Tokens</div>
            <div className="font-mono">
              {step.input_tokens.toLocaleString()} in / {(step.output_tokens || 0).toLocaleString()} out
            </div>
          </>
        )}

        {step.model && (
          <>
            <div className="text-foreground-muted">Model</div>
            <div className="font-mono text-[11px]">{step.model}</div>
          </>
        )}
      </div>
    </div>
  );
}
