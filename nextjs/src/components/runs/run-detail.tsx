"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  Activity,
  FileText,
  Clock,
  Terminal,
  ArrowRightLeft,
  Brain,
  Wrench,
  Database,
  User,
  Shield,
  CheckCircle,
  XCircle,
  Loader2,
  Sparkles,
  ChevronRight,
} from "lucide-react";
import { useRun, useSteps } from "@/hooks/use-runs";
import { RunHeader } from "./run-header";
import { StepTimeline } from "./step-timeline";
import { TraceWaterfall } from "./trace-waterfall";
import { StepDetailPanel } from "./step-detail-panel";
import { ArtifactsTab } from "./artifacts-tab";
import { AuditTab } from "./audit-tab";
import { InputOutputTab } from "./input-output-tab";
import { LoadingPage } from "@/components/shared/loading-spinner";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatDuration } from "@/lib/utils";
import type { Step, StepArtifact, StepType, StepStatus } from "@/types/run";

// Step type configuration for compact timeline
const stepTypeConfig: Record<
  StepType,
  {
    icon: typeof Brain;
    gradient: string;
    color: string;
    bgColor: string;
  }
> = {
  llm: {
    icon: Brain,
    gradient: "from-purple-500 to-violet-600",
    color: "text-purple-400",
    bgColor: "bg-purple-500/10",
  },
  tool: {
    icon: Wrench,
    gradient: "from-blue-500 to-cyan-500",
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
  },
  retrieval: {
    icon: Database,
    gradient: "from-cyan-500 to-teal-500",
    color: "text-cyan-400",
    bgColor: "bg-cyan-500/10",
  },
  human: {
    icon: User,
    gradient: "from-orange-500 to-amber-500",
    color: "text-orange-400",
    bgColor: "bg-orange-500/10",
  },
  approval: {
    icon: Shield,
    gradient: "from-yellow-500 to-amber-500",
    color: "text-yellow-400",
    bgColor: "bg-yellow-500/10",
  },
};

// Step status configuration
const stepStatusConfig: Record<
  StepStatus,
  {
    icon: typeof CheckCircle;
    color: string;
    bgColor: string;
    borderColor: string;
    pulse?: boolean;
  }
> = {
  pending: {
    icon: Clock,
    color: "text-slate-400",
    bgColor: "bg-slate-500/10",
    borderColor: "border-slate-500/30",
  },
  running: {
    icon: Loader2,
    color: "text-yellow-400",
    bgColor: "bg-yellow-500/10",
    borderColor: "border-yellow-500/50",
    pulse: true,
  },
  waiting_approval: {
    icon: Shield,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/50",
    pulse: true,
  },
  completed: {
    icon: CheckCircle,
    color: "text-green-400",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/30",
  },
  failed: {
    icon: XCircle,
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/30",
  },
  skipped: {
    icon: Clock,
    color: "text-slate-400",
    bgColor: "bg-slate-500/10",
    borderColor: "border-slate-500/30",
  },
};

// Tab configuration for smooth transitions
const tabConfig = [
  { id: "trace", icon: Activity, label: "Trace" },
  { id: "steps", icon: Terminal, label: "Steps" },
  { id: "artifacts", icon: FileText, label: "Artifacts" },
  { id: "audit", icon: Clock, label: "Audit" },
  { id: "io", icon: ArrowRightLeft, label: "I/O" },
];

interface RunDetailProps {
  runId: string;
}

export function RunDetail({ runId }: RunDetailProps) {
  const {
    data: run,
    isLoading: runLoading,
    error: runError,
  } = useRun(runId);
  const { data: steps, isLoading: stepsLoading } = useSteps(runId);

  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("trace");
  const [isTabTransitioning, setIsTabTransitioning] = useState(false);

  // Find the selected step
  const selectedStep = useMemo(() => {
    if (!selectedStepId || !steps) return null;
    return steps.find((s) => s.id === selectedStepId) || null;
  }, [selectedStepId, steps]);

  // Auto-select first step if none selected
  useEffect(() => {
    if (!selectedStepId && steps && steps.length > 0) {
      // Defer to avoid synchronous setState during render
      queueMicrotask(() => setSelectedStepId(steps[0].id));
    }
  }, [selectedStepId, steps]);

  // Mock artifacts (in a real implementation, these would come from an API)
  const artifacts: StepArtifact[] = useMemo(() => {
    return [];
  }, []);

  // Smooth tab transition handler
  const handleTabChange = useCallback((newTab: string) => {
    if (newTab === activeTab) return;
    setIsTabTransitioning(true);
    setTimeout(() => {
      setActiveTab(newTab);
      setTimeout(() => {
        setIsTabTransitioning(false);
      }, 50);
    }, 150);
  }, [activeTab]);

  if (runLoading) {
    return <LoadingPage />;
  }

  if (runError || !run) {
    return (
      <EmptyState
        icon={Activity}
        title="Run not found"
        description="The run you're looking for doesn't exist or has been deleted."
      />
    );
  }

  const stepCount = steps?.length || 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <RunHeader run={run} stepCount={stepCount} />

      {/* Custom Tab Navigation */}
      <div className="relative">
        {/* Tab List with Mission Control styling */}
        <div className="flex items-center gap-1 p-1 bg-background-secondary/50 rounded-lg border border-border/50 w-fit">
          {tabConfig.map((tab) => {
            const isActive = activeTab === tab.id;
            const TabIcon = tab.icon;

            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={cn(
                  "relative flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all duration-200",
                  isActive
                    ? "bg-background text-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                )}
              >
                <TabIcon className={cn("h-4 w-4", isActive && "text-accent-primary")} />
                <span>{tab.label}</span>

                {/* Step count badge */}
                {tab.id === "steps" && stepCount > 0 && (
                  <Badge
                    variant="secondary"
                    className={cn(
                      "ml-1 h-5 px-1.5 text-[10px] font-mono",
                      isActive ? "bg-accent-primary/10 text-accent-primary" : ""
                    )}
                  >
                    {stepCount}
                  </Badge>
                )}

                {/* Live indicator for trace tab */}
                {tab.id === "trace" && isActive && run.status === "running" && (
                  <span className="relative flex h-2 w-2 ml-1">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                  </span>
                )}

                {/* Active indicator line */}
                {isActive && (
                  <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-gradient-to-r from-accent-primary to-accent-secondary rounded-full" />
                )}
              </button>
            );
          })}
        </div>

        {/* Tab Content with smooth transitions */}
        <div
          className={cn(
            "mt-4 transition-all duration-200",
            isTabTransitioning ? "opacity-0 translate-y-2" : "opacity-100 translate-y-0"
          )}
        >
          {/* Trace Tab - Default */}
          {activeTab === "trace" && (
            <TraceTabContent
              steps={steps || []}
              selectedStepId={selectedStepId}
              onSelectStep={setSelectedStepId}
              selectedStep={selectedStep}
              isLoading={stepsLoading}
              runStartTime={run.started_at}
              runEndTime={run.completed_at}
            />
          )}

          {/* Steps Tab */}
          {activeTab === "steps" && (
            <>
              {stepsLoading ? (
                <LoadingPage />
              ) : steps && steps.length > 0 ? (
                <StepTimeline steps={steps} />
              ) : (
                <EmptyState
                  icon={Activity}
                  title="No steps yet"
                  description="Steps will appear here once the run starts executing."
                  variant="compact"
                />
              )}
            </>
          )}

          {/* Artifacts Tab */}
          {activeTab === "artifacts" && <ArtifactsTab artifacts={artifacts} />}

          {/* Audit Tab */}
          {activeTab === "audit" && <AuditTab run={run} steps={steps || []} />}

          {/* Input/Output Tab */}
          {activeTab === "io" && <InputOutputTab run={run} />}
        </div>
      </div>
    </div>
  );
}

// Trace tab with waterfall + split view
interface TraceTabContentProps {
  steps: Step[];
  selectedStepId: string | null;
  onSelectStep: (id: string) => void;
  selectedStep: Step | null;
  isLoading: boolean;
  runStartTime?: string;
  runEndTime?: string;
}

function TraceTabContent({
  steps,
  selectedStepId,
  onSelectStep,
  selectedStep,
  isLoading,
  runStartTime,
  runEndTime,
}: TraceTabContentProps) {
  if (isLoading) {
    return <LoadingPage />;
  }

  if (steps.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="No steps yet"
        description="Steps will appear here once the run starts executing."
        variant="compact"
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Trace Waterfall - horizontal timeline */}
      <TraceWaterfall
        steps={steps}
        selectedStepId={selectedStepId || undefined}
        onSelectStep={onSelectStep}
        runStartTime={runStartTime}
        runEndTime={runEndTime}
      />

      {/* Split view: Timeline + Detail Panel */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Left: Vertical step timeline (compact) */}
        <Card className="overflow-hidden border-border/50">
          <div className="p-3 border-b border-border/50 bg-gradient-to-r from-background-secondary to-background-tertiary/50">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-accent-primary" />
                  Step Timeline
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Click a step to view details
                </p>
              </div>
              <Badge variant="outline" className="text-xs font-mono">
                {steps.length} steps
              </Badge>
            </div>
          </div>
          <CardContent className="p-0">
            <div className="max-h-[400px] overflow-auto p-4">
              <CompactStepTimeline
                steps={steps}
                selectedStepId={selectedStepId}
                onSelectStep={onSelectStep}
              />
            </div>
          </CardContent>
        </Card>

        {/* Right: Step detail panel */}
        <StepDetailPanel step={selectedStep} className="h-[480px]" />
      </div>
    </div>
  );
}

// Compact step timeline for split view
interface CompactStepTimelineProps {
  steps: Step[];
  selectedStepId: string | null;
  onSelectStep: (id: string) => void;
}

function CompactStepTimeline({
  steps,
  selectedStepId,
  onSelectStep,
}: CompactStepTimelineProps) {
  const sortedSteps = useMemo(() => {
    return [...steps].sort((a, b) => {
      if (a.step_number && b.step_number) return a.step_number - b.step_number;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  }, [steps]);

  return (
    <div className="relative">
      {/* Gradient timeline line */}
      <div className="absolute left-3 top-0 bottom-0 w-px">
        <div className="absolute inset-0 bg-gradient-to-b from-purple-500/40 via-blue-500/30 to-cyan-500/40" />
      </div>

      <div className="space-y-2">
        {sortedSteps.map((step, index) => (
          <CompactStepCard
            key={step.id}
            step={step}
            stepIndex={index}
            isSelected={step.id === selectedStepId}
            onClick={() => onSelectStep(step.id)}
          />
        ))}
      </div>
    </div>
  );
}

interface CompactStepCardProps {
  step: Step;
  stepIndex: number;
  isSelected: boolean;
  onClick: () => void;
}

function CompactStepCard({ step, stepIndex, isSelected, onClick }: CompactStepCardProps) {
  const typeConfig = stepTypeConfig[step.step_type] || stepTypeConfig.tool;
  const statusConfig = stepStatusConfig[step.status] || stepStatusConfig.pending;
  const TypeIcon = typeConfig.icon;
  const StatusIcon = statusConfig.icon;
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  // Update current time for running steps
  useEffect(() => {
    if (step.status === "running" && step.started_at && !step.completed_at) {
      const interval = setInterval(() => {
        setCurrentTime(Date.now());
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [step.status, step.started_at, step.completed_at]);

  const duration =
    step.started_at && step.completed_at
      ? new Date(step.completed_at).getTime() - new Date(step.started_at).getTime()
      : step.started_at && currentTime > 0
      ? currentTime - new Date(step.started_at).getTime()
      : 0;

  return (
    <div
      onClick={onClick}
      className={cn(
        "relative pl-8 py-2 px-3 rounded-lg cursor-pointer transition-all duration-200 group",
        "animate-fade-in",
        isSelected
          ? "bg-accent-primary/10 border border-accent-primary/30 shadow-sm"
          : "hover:bg-background-tertiary/50 border border-transparent"
      )}
      style={{ animationDelay: `${stepIndex * 30}ms` }}
    >
      {/* Timeline node */}
      <div
        className={cn(
          "absolute left-0 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center",
          "border transition-all duration-200",
          isSelected ? statusConfig.borderColor : "border-border/50",
          isSelected ? statusConfig.bgColor : "bg-background-secondary",
          statusConfig.pulse && "animate-pulse"
        )}
      >
        <div
          className={cn(
            "w-4 h-4 rounded-full bg-gradient-to-br flex items-center justify-center",
            typeConfig.gradient
          )}
        >
          <TypeIcon className="h-2.5 w-2.5 text-white" />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "text-sm font-medium truncate transition-colors",
                isSelected ? typeConfig.color : "text-foreground"
              )}
            >
              {step.tool_name || step.model || step.step_type}
            </span>
            {step.step_number && (
              <Badge variant="outline" className="text-[10px] font-mono px-1 py-0 h-4">
                #{step.step_number}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
            {duration > 0 && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatDuration(duration)}
              </span>
            )}
            {(step.input_tokens || step.output_tokens) && (
              <span className="flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-purple-400" />
                {(step.input_tokens || 0) + (step.output_tokens || 0)}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <StatusIcon
            className={cn(
              "h-4 w-4",
              statusConfig.color,
              step.status === "running" && "animate-spin"
            )}
          />
          <ChevronRight
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              isSelected && "translate-x-0.5"
            )}
          />
        </div>
      </div>
    </div>
  );
}
