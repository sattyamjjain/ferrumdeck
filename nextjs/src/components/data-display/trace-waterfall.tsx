"use client";

import {
  useRef,
  useState,
  useCallback,
  useMemo,
  useEffect,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  Brain,
  Wrench,
  Database,
  User,
  Shield,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Step, StepType, StepStatus } from "@/types/run";

// Step type configuration with colors matching the design system
const STEP_TYPE_CONFIG: Record<
  StepType,
  { icon: typeof Brain; label: string; color: string; bgColor: string }
> = {
  llm: {
    icon: Brain,
    label: "LLM",
    color: "#a855f7",
    bgColor: "rgba(168, 85, 247, 0.15)",
  },
  tool: {
    icon: Wrench,
    label: "Tool",
    color: "#3b82f6",
    bgColor: "rgba(59, 130, 246, 0.15)",
  },
  retrieval: {
    icon: Database,
    label: "Retrieval",
    color: "#06b6d4",
    bgColor: "rgba(6, 182, 212, 0.15)",
  },
  human: {
    icon: User,
    label: "Human",
    color: "#f97316",
    bgColor: "rgba(249, 115, 22, 0.15)",
  },
  approval: {
    icon: Shield,
    label: "Approval",
    color: "#eab308",
    bgColor: "rgba(234, 179, 8, 0.15)",
  },
};

// Constants for rendering
const ROW_HEIGHT = 36;
const ROW_GAP = 4;
const LABEL_WIDTH = 180;
const TIME_AXIS_HEIGHT = 32;
const MIN_BAR_WIDTH = 4;
const ZOOM_FACTOR = 1.2;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;

interface ProcessedStep {
  step: Step;
  startTime: number;
  endTime: number;
  duration: number;
  isRunning: boolean;
}

interface TraceWaterfallProps {
  steps: Step[];
  selectedStepId?: string;
  onStepSelect?: (step: Step) => void;
  className?: string;
}

export function TraceWaterfall({
  steps,
  selectedStepId,
  onStepSelect,
  className,
}: TraceWaterfallProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // State for zoom and pan
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartOffset, setDragStartOffset] = useState(0);
  const [hoveredStepId, setHoveredStepId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Update current time for running steps animation
  useEffect(() => {
    const hasRunningSteps = steps.some((s) => s.status === "running");
    if (!hasRunningSteps) return;

    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 100);

    return () => clearInterval(interval);
  }, [steps]);

  // Process steps to calculate timing
  const { processedSteps, totalDuration } = useMemo(() => {
    if (steps.length === 0) {
      return { processedSteps: [], totalDuration: 0 };
    }

    const sortedSteps = [...steps].sort((a, b) => {
      const aTime = a.started_at || a.created_at;
      const bTime = b.started_at || b.created_at;
      return new Date(aTime).getTime() - new Date(bTime).getTime();
    });

    const startTimes = sortedSteps.map(
      (s) => new Date(s.started_at || s.created_at).getTime()
    );
    const minTime = Math.min(...startTimes);

    const processed: ProcessedStep[] = sortedSteps.map((step) => {
      const startTime =
        new Date(step.started_at || step.created_at).getTime() - minTime;
      const isRunning = step.status === "running";

      let endTime: number;
      if (step.completed_at) {
        endTime = new Date(step.completed_at).getTime() - minTime;
      } else if (isRunning) {
        endTime = currentTime - minTime;
      } else {
        // Pending or waiting steps get a minimal duration for visibility
        endTime = startTime + 100;
      }

      return {
        step,
        startTime,
        endTime,
        duration: endTime - startTime,
        isRunning,
      };
    });

    const maxEndTime = Math.max(...processed.map((p) => p.endTime));

    return {
      processedSteps: processed,
      totalDuration: maxEndTime,
    };
  }, [steps, currentTime]);

  // Calculate visible dimensions
  const containerWidth = containerRef.current?.clientWidth || 800;
  const timelineWidth = containerWidth - LABEL_WIDTH - 40;
  const scaledWidth = timelineWidth * zoom;

  // Convert time to X position
  const timeToX = useCallback(
    (time: number) => {
      if (totalDuration === 0) return 0;
      return (time / totalDuration) * scaledWidth + panOffset;
    },
    [totalDuration, scaledWidth, panOffset]
  );

  // Format duration for display
  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  // Format time axis labels
  const formatTimeAxisLabel = (ms: number): string => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  // Generate time axis ticks
  const timeAxisTicks = useMemo(() => {
    const ticks: { time: number; x: number; label: string }[] = [];
    if (totalDuration === 0) return ticks;

    // Calculate appropriate tick interval based on zoom
    const visibleDuration = totalDuration / zoom;
    let tickInterval: number;

    if (visibleDuration < 1000) {
      tickInterval = 100; // 100ms ticks
    } else if (visibleDuration < 10000) {
      tickInterval = 1000; // 1s ticks
    } else if (visibleDuration < 60000) {
      tickInterval = 5000; // 5s ticks
    } else if (visibleDuration < 300000) {
      tickInterval = 30000; // 30s ticks
    } else {
      tickInterval = 60000; // 1m ticks
    }

    // Calculate visible time range based on pan offset
    const pixelToTime = (px: number) =>
      ((px - panOffset) / scaledWidth) * totalDuration;
    const visibleStart = Math.max(0, pixelToTime(0));
    const visibleEnd = Math.min(totalDuration, pixelToTime(timelineWidth));

    const startTick = Math.floor(visibleStart / tickInterval) * tickInterval;

    for (let time = startTick; time <= visibleEnd + tickInterval; time += tickInterval) {
      const x = timeToX(time);
      if (x >= -50 && x <= timelineWidth + 50) {
        ticks.push({
          time,
          x,
          label: formatTimeAxisLabel(time),
        });
      }
    }

    return ticks;
  }, [totalDuration, zoom, panOffset, scaledWidth, timelineWidth, timeToX]);

  // Zoom handlers
  const handleZoomIn = () => {
    setZoom((prev) => Math.min(prev * ZOOM_FACTOR, MAX_ZOOM));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(prev / ZOOM_FACTOR, MIN_ZOOM));
  };

  const handleResetZoom = () => {
    setZoom(1);
    setPanOffset(0);
  };

  const handleFitToView = () => {
    setZoom(1);
    setPanOffset(0);
  };

  // Wheel zoom handler
  const handleWheel = (e: ReactWheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 1 / ZOOM_FACTOR : ZOOM_FACTOR;
      const newZoom = Math.max(MIN_ZOOM, Math.min(zoom * delta, MAX_ZOOM));

      // Zoom centered on mouse position
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const mouseX = e.clientX - rect.left - LABEL_WIDTH;
        const timeAtMouse =
          ((mouseX - panOffset) / scaledWidth) * totalDuration;
        const newScaledWidth = timelineWidth * newZoom;
        const newX = (timeAtMouse / totalDuration) * newScaledWidth;
        setPanOffset(mouseX - newX);
      }

      setZoom(newZoom);
    } else {
      // Horizontal scroll for panning
      setPanOffset((prev) => {
        const newOffset = prev - e.deltaX;
        const maxOffset = 0;
        const minOffset = Math.min(0, timelineWidth - scaledWidth);
        return Math.max(minOffset, Math.min(maxOffset, newOffset));
      });
    }
  };

  // Pan handlers
  const handleMouseDown = (e: ReactMouseEvent) => {
    if (e.button === 0) {
      setIsDragging(true);
      setDragStartX(e.clientX);
      setDragStartOffset(panOffset);
    }
  };

  const handleMouseMove = useCallback(
    (e: ReactMouseEvent) => {
      if (isDragging) {
        const deltaX = e.clientX - dragStartX;
        const newOffset = dragStartOffset + deltaX;
        const maxOffset = 0;
        const minOffset = Math.min(0, timelineWidth - scaledWidth);
        setPanOffset(Math.max(minOffset, Math.min(maxOffset, newOffset)));
      }
    },
    [isDragging, dragStartX, dragStartOffset, timelineWidth, scaledWidth]
  );

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Step click handler
  const handleStepClick = (step: Step) => {
    onStepSelect?.(step);
  };

  if (steps.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center h-48 text-muted-foreground",
          className
        )}
      >
        No steps to display
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-background-secondary">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {steps.length} steps
          </span>
          <span className="text-xs text-muted-foreground">
            | Total: {formatDuration(totalDuration)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleZoomOut}
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom out</TooltipContent>
          </Tooltip>
          <span className="text-xs text-muted-foreground w-12 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleZoomIn}
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom in</TooltipContent>
          </Tooltip>
          <div className="w-px h-4 bg-border mx-1" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleResetZoom}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reset zoom</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleFitToView}
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Fit to view</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Main content */}
      <div
        ref={containerRef}
        className="relative overflow-hidden bg-background"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        style={{ cursor: isDragging ? "grabbing" : "grab" }}
      >
        {/* Time axis */}
        <div
          className="sticky top-0 z-10 flex border-b border-border bg-background-secondary"
          style={{ height: TIME_AXIS_HEIGHT }}
        >
          {/* Label column header */}
          <div
            className="flex-shrink-0 border-r border-border px-3 flex items-center"
            style={{ width: LABEL_WIDTH }}
          >
            <span className="text-xs font-medium text-muted-foreground">
              Step
            </span>
          </div>

          {/* Time axis ticks */}
          <div
            ref={canvasRef}
            className="relative flex-1 overflow-hidden"
            style={{ height: TIME_AXIS_HEIGHT }}
          >
            {timeAxisTicks.map((tick, i) => (
              <div
                key={i}
                className="absolute top-0 flex flex-col items-center"
                style={{
                  left: tick.x,
                  transform: "translateX(-50%)",
                }}
              >
                <span className="text-[10px] text-muted-foreground mt-1">
                  {tick.label}
                </span>
                <div className="w-px h-2 bg-border mt-1" />
              </div>
            ))}
          </div>
        </div>

        {/* Steps rows */}
        <div
          className="relative"
          style={{
            height: processedSteps.length * (ROW_HEIGHT + ROW_GAP) + ROW_GAP,
          }}
        >
          {processedSteps.map((processed, index) => {
            const { step, startTime, duration, isRunning } = processed;
            const config = STEP_TYPE_CONFIG[step.step_type] || STEP_TYPE_CONFIG.tool;
            const Icon = config.icon;
            const isSelected = selectedStepId === step.id;
            const isHovered = hoveredStepId === step.id;
            const isFailed = step.status === "failed";

            const barX = timeToX(startTime);
            const barWidth = Math.max(
              (duration / totalDuration) * scaledWidth,
              MIN_BAR_WIDTH
            );

            return (
              <div
                key={step.id}
                className={cn(
                  "absolute left-0 right-0 flex transition-colors duration-100",
                  isSelected && "bg-accent/30",
                  isHovered && !isSelected && "bg-accent/15"
                )}
                style={{
                  top: index * (ROW_HEIGHT + ROW_GAP) + ROW_GAP,
                  height: ROW_HEIGHT,
                }}
                onMouseEnter={() => setHoveredStepId(step.id)}
                onMouseLeave={() => setHoveredStepId(null)}
              >
                {/* Label column */}
                <div
                  className="flex-shrink-0 border-r border-border px-3 flex items-center gap-2 cursor-pointer"
                  style={{ width: LABEL_WIDTH }}
                  onClick={() => handleStepClick(step)}
                >
                  <Icon
                    className="h-4 w-4 flex-shrink-0"
                    style={{ color: config.color }}
                  />
                  <span className="text-sm truncate">
                    {step.tool_name || step.model || config.label}
                  </span>
                  {step.step_number !== undefined && (
                    <span className="text-xs text-muted-foreground">
                      #{step.step_number}
                    </span>
                  )}
                </div>

                {/* Timeline bar */}
                <div className="relative flex-1 overflow-hidden">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className={cn(
                          "absolute top-1/2 -translate-y-1/2 rounded-sm cursor-pointer transition-all duration-100",
                          isRunning && "animate-pulse",
                          isSelected && "ring-2 ring-primary ring-offset-1 ring-offset-background"
                        )}
                        style={{
                          left: Math.max(0, barX),
                          width: Math.max(MIN_BAR_WIDTH, barWidth),
                          height: ROW_HEIGHT - 12,
                          backgroundColor: isFailed
                            ? "rgba(239, 68, 68, 0.6)"
                            : config.color,
                          opacity: isHovered || isSelected ? 1 : 0.8,
                          boxShadow: isFailed
                            ? "0 0 8px rgba(239, 68, 68, 0.4)"
                            : undefined,
                        }}
                        onClick={() => handleStepClick(step)}
                      >
                        {/* Running indicator */}
                        {isRunning && (
                          <div
                            className="absolute right-0 top-0 bottom-0 w-1 rounded-r-sm"
                            style={{
                              background: `linear-gradient(180deg, ${config.color}, transparent, ${config.color})`,
                              animation: "pulse 1s infinite",
                            }}
                          />
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      className="bg-background-elevated border border-border p-3 min-w-48"
                    >
                      <StepTooltip step={step} duration={duration} />
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-2 border-t border-border bg-background-secondary">
        {Object.entries(STEP_TYPE_CONFIG).map(([type, config]) => (
          <div key={type} className="flex items-center gap-1.5">
            <div
              className="w-3 h-3 rounded-sm"
              style={{ backgroundColor: config.color }}
            />
            <span className="text-xs text-muted-foreground">{config.label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 ml-4">
          <div
            className="w-3 h-3 rounded-sm"
            style={{ backgroundColor: "rgba(239, 68, 68, 0.6)" }}
          />
          <span className="text-xs text-muted-foreground">Failed</span>
        </div>
      </div>
    </div>
  );
}

// Tooltip content for step hover
interface StepTooltipProps {
  step: Step;
  duration: number;
}

function StepTooltip({ step, duration }: StepTooltipProps) {
  const config = STEP_TYPE_CONFIG[step.step_type] || STEP_TYPE_CONFIG.tool;

  const formatTokens = (tokens: number | undefined) => {
    if (tokens === undefined) return "-";
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
    return String(tokens);
  };

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    return `${(ms / 60000).toFixed(2)}m`;
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: config.color }}
        />
        <span className="font-medium text-sm">
          {step.tool_name || step.model || config.label}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <span className="text-muted-foreground">Duration:</span>
        <span>{formatDuration(duration)}</span>

        {step.input_tokens !== undefined && (
          <>
            <span className="text-muted-foreground">Tokens In:</span>
            <span>{formatTokens(step.input_tokens)}</span>
          </>
        )}

        {step.output_tokens !== undefined && (
          <>
            <span className="text-muted-foreground">Tokens Out:</span>
            <span>{formatTokens(step.output_tokens)}</span>
          </>
        )}

        <span className="text-muted-foreground">Status:</span>
        <span
          className={cn(
            step.status === "completed" && "text-accent-green",
            step.status === "failed" && "text-accent-red",
            step.status === "running" && "text-accent-yellow"
          )}
        >
          {step.status}
        </span>
      </div>

      {step.status === "failed" && step.error && (
        <div className="text-xs text-accent-red pt-1 border-t border-border">
          {typeof step.error === "string"
            ? step.error
            : JSON.stringify(step.error).slice(0, 100)}
        </div>
      )}
    </div>
  );
}
