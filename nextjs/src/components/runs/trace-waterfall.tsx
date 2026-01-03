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
} from "lucide-react";
import { cn, formatDuration } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Step, StepType, StepStatus } from "@/types/run";

const stepTypeConfig: Record<
  StepType,
  { icon: typeof Brain; label: string; color: string; bgColor: string }
> = {
  llm: {
    icon: Brain,
    label: "LLM",
    color: "text-purple-400",
    bgColor: "bg-purple-500",
  },
  tool: {
    icon: Wrench,
    label: "Tool",
    color: "text-blue-400",
    bgColor: "bg-blue-500",
  },
  retrieval: {
    icon: Database,
    label: "Retrieval",
    color: "text-cyan-400",
    bgColor: "bg-cyan-500",
  },
  human: {
    icon: User,
    label: "Human",
    color: "text-orange-400",
    bgColor: "bg-orange-500",
  },
  approval: {
    icon: Shield,
    label: "Approval",
    color: "text-yellow-400",
    bgColor: "bg-yellow-500",
  },
};

const stepStatusConfig: Record<
  StepStatus,
  { icon: typeof CheckCircle; className: string }
> = {
  pending: { icon: Clock, className: "bg-secondary" },
  running: { icon: Loader2, className: "bg-yellow-500" },
  waiting_approval: { icon: Shield, className: "bg-amber-500" },
  completed: { icon: CheckCircle, className: "bg-green-500" },
  failed: { icon: XCircle, className: "bg-red-500" },
  skipped: { icon: Clock, className: "bg-secondary" },
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

  // Sort steps by start time
  const sortedSteps = useMemo(() => {
    return [...steps].sort((a, b) => {
      const aTime = a.started_at || a.created_at;
      const bTime = b.started_at || b.created_at;
      return new Date(aTime).getTime() - new Date(bTime).getTime();
    });
  }, [steps]);

  // State for current time (for running steps)
  const [currentTime, setCurrentTime] = useState(0);

  // Initialize current time
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentTime(Date.now());
  }, []);

  // Calculate time bounds for the waterfall
  const { minTime, totalDuration } = useMemo(() => {
    if (sortedSteps.length === 0) {
      return { minTime: 0, totalDuration: 0 };
    }

    const startTimes = sortedSteps.map((s) =>
      new Date(s.started_at || s.created_at).getTime()
    );
    const endTimes = sortedSteps.map((s) =>
      new Date(s.completed_at || s.started_at || s.created_at).getTime()
    );

    const min = runStartTime
      ? new Date(runStartTime).getTime()
      : Math.min(...startTimes);
    const max = runEndTime
      ? new Date(runEndTime).getTime()
      : Math.max(...endTimes, currentTime > 0 ? currentTime : endTimes[endTimes.length - 1] || 0);

    return {
      minTime: min,
      totalDuration: max - min,
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

  // Time scale markers - must be before early return
  const timeMarkers = useMemo(() => {
    if (totalDuration === 0) return [];
    const markers: number[] = [];
    const interval = totalDuration / 5;
    for (let i = 0; i <= 5; i++) {
      markers.push(minTime + interval * i);
    }
    return markers;
  }, [minTime, totalDuration]);

  if (sortedSteps.length === 0) {
    return (
      <div className="h-24 flex items-center justify-center text-muted-foreground text-sm">
        No steps to display
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="border rounded-lg bg-background-secondary/30 overflow-hidden">
        {/* Time scale header */}
        <div className="flex items-center border-b bg-background-tertiary/50 px-4 py-2">
          <div className="w-32 shrink-0 text-xs text-muted-foreground font-medium">
            Timeline
          </div>
          <div className="flex-1 relative h-4">
            {timeMarkers.map((time, i) => (
              <div
                key={i}
                className="absolute text-[10px] text-muted-foreground font-mono"
                style={{
                  left: `${((time - minTime) / totalDuration) * 100}%`,
                  transform: "translateX(-50%)",
                }}
              >
                {formatDuration(time - minTime)}
              </div>
            ))}
          </div>
        </div>

        {/* Waterfall rows */}
        <div
          ref={containerRef}
          className="overflow-x-auto overflow-y-hidden"
          style={{ maxHeight: "200px" }}
        >
          <div className="min-w-[600px]">
            {sortedSteps.map((step) => {
              const typeConfig =
                stepTypeConfig[step.step_type] || stepTypeConfig.tool;
              const statusConfig =
                stepStatusConfig[step.status] || stepStatusConfig.pending;
              const TypeIcon = typeConfig.icon;
              const StatusIcon = statusConfig.icon;

              const stepStart = new Date(
                step.started_at || step.created_at
              ).getTime();
              const stepEnd = new Date(
                step.completed_at || step.started_at || step.created_at
              ).getTime();
              const isRunning = step.status === "running";

              // Calculate position and width
              const left = ((stepStart - minTime) / totalDuration) * 100;
              const runningTime = currentTime > 0 ? currentTime : stepEnd;
              const width = isRunning
                ? ((runningTime - stepStart) / totalDuration) * 100
                : ((stepEnd - stepStart) / totalDuration) * 100;
              const minWidth = 2; // Minimum visible width

              const isSelected = step.id === selectedStepId;

              return (
                <div
                  key={step.id}
                  ref={isSelected ? selectedRef : undefined}
                  className={cn(
                    "flex items-center h-8 px-4 border-b border-border/30 cursor-pointer transition-colors",
                    isSelected
                      ? "bg-accent-blue/10"
                      : "hover:bg-background-tertiary/50"
                  )}
                  onClick={() => onSelectStep(step.id)}
                >
                  {/* Step label */}
                  <div className="w-32 shrink-0 flex items-center gap-2 pr-2">
                    <TypeIcon className={cn("h-3.5 w-3.5", typeConfig.color)} />
                    <span className="text-xs truncate">
                      {step.tool_name || step.model || typeConfig.label}
                    </span>
                  </div>

                  {/* Timeline bar */}
                  <div className="flex-1 relative h-full flex items-center">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className={cn(
                            "absolute h-4 rounded-sm transition-all",
                            typeConfig.bgColor,
                            isRunning && "animate-pulse",
                            isSelected && "ring-2 ring-accent-blue ring-offset-1 ring-offset-background"
                          )}
                          style={{
                            left: `${left}%`,
                            width: `${Math.max(width, minWidth)}%`,
                            opacity: step.status === "pending" ? 0.3 : 0.8,
                          }}
                        >
                          {/* Status indicator at the end */}
                          <div
                            className={cn(
                              "absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-3 h-3 rounded-full flex items-center justify-center",
                              statusConfig.className
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
                        <div className="space-y-1">
                          <div className="font-medium">
                            {step.tool_name || step.model || typeConfig.label}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Status: {step.status}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Duration:{" "}
                            {formatDuration(
                              isRunning ? runningTime - stepStart : stepEnd - stepStart
                            )}
                          </div>
                          {step.input_tokens && (
                            <div className="text-xs text-muted-foreground">
                              Tokens: {step.input_tokens} in /{" "}
                              {step.output_tokens || 0} out
                            </div>
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 px-4 py-2 border-t bg-background-tertiary/30 text-xs text-muted-foreground">
          {Object.entries(stepTypeConfig).map(([type, config]) => (
            <div key={type} className="flex items-center gap-1.5">
              <div className={cn("w-3 h-2 rounded-sm", config.bgColor)} />
              <span>{config.label}</span>
            </div>
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}
