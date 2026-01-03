"use client";

import { useState, useMemo, useEffect } from "react";
import { Activity, FileText, Clock, Terminal, ArrowRightLeft } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { isRunActive } from "@/lib/utils";
import type { Step, StepArtifact } from "@/types/run";

interface RunDetailProps {
  runId: string;
}

export function RunDetail({ runId }: RunDetailProps) {
  const {
    data: run,
    isLoading: runLoading,
    error: runError,
  } = useRun(runId);
  const {
    data: steps,
    isLoading: stepsLoading,
  } = useSteps(runId);

  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("trace");

  // Find the selected step
  const selectedStep = useMemo(() => {
    if (!selectedStepId || !steps) return null;
    return steps.find((s) => s.id === selectedStepId) || null;
  }, [selectedStepId, steps]);

  // Auto-select first step if none selected
  useEffect(() => {
    if (!selectedStepId && steps && steps.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedStepId(steps[0].id);
    }
  }, [selectedStepId, steps]);

  // Mock artifacts (in a real implementation, these would come from an API)
  const artifacts: StepArtifact[] = useMemo(() => {
    // For now, return empty - this would be fetched from API
    return [];
  }, []);

  // Determine if run is active for polling indicator
  const isActive = run ? isRunActive(run.status) : false;

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
    <div className="space-y-6">
      <RunHeader run={run} stepCount={stepCount} />

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="w-full"
      >
        <TabsList className="mb-4">
          <TabsTrigger value="trace" className="gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            Trace
            {isActive && (
              <Badge
                variant="outline"
                className="ml-1 h-4 px-1 text-[10px] bg-accent-green/10 text-accent-green border-accent-green/30"
              >
                Live
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="steps" className="gap-1.5">
            <Terminal className="h-3.5 w-3.5" />
            Steps
            {stepCount > 0 && (
              <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px]">
                {stepCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="artifacts" className="gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            Artifacts
            {artifacts.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px]">
                {artifacts.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            Audit
          </TabsTrigger>
          <TabsTrigger value="io" className="gap-1.5">
            <ArrowRightLeft className="h-3.5 w-3.5" />
            Input/Output
          </TabsTrigger>
        </TabsList>

        {/* Trace Tab - Default */}
        <TabsContent value="trace" className="mt-0">
          <TraceTabContent
            steps={steps || []}
            selectedStepId={selectedStepId}
            onSelectStep={setSelectedStepId}
            selectedStep={selectedStep}
            isLoading={stepsLoading}
            runStartTime={run.started_at}
            runEndTime={run.completed_at}
          />
        </TabsContent>

        {/* Steps Tab */}
        <TabsContent value="steps" className="mt-0">
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
        </TabsContent>

        {/* Artifacts Tab */}
        <TabsContent value="artifacts" className="mt-0">
          <ArtifactsTab artifacts={artifacts} />
        </TabsContent>

        {/* Audit Tab */}
        <TabsContent value="audit" className="mt-0">
          <AuditTab run={run} steps={steps || []} />
        </TabsContent>

        {/* Input/Output Tab */}
        <TabsContent value="io" className="mt-0">
          <InputOutputTab run={run} />
        </TabsContent>
      </Tabs>
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
        <Card>
          <CardContent className="p-0">
            <div className="p-3 border-b bg-background-tertiary/50">
              <h3 className="text-sm font-medium">Step Timeline</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Click a step to view details
              </p>
            </div>
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
      return (
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    });
  }, [steps]);

  return (
    <div className="relative">
      {/* Timeline line */}
      <div className="absolute left-3 top-0 bottom-0 w-px bg-border" />

      <div className="space-y-2">
        {sortedSteps.map((step) => (
          <CompactStepCard
            key={step.id}
            step={step}
            isSelected={step.id === selectedStepId}
            onClick={() => onSelectStep(step.id)}
          />
        ))}
      </div>
    </div>
  );
}

import {
  Brain,
  Wrench,
  Database,
  User,
  Shield,
  CheckCircle,
  XCircle,
  Loader2,
} from "lucide-react";
import { cn, formatDuration } from "@/lib/utils";
import type { StepType, StepStatus } from "@/types/run";

const stepTypeIcons: Record<StepType, typeof Brain> = {
  llm: Brain,
  tool: Wrench,
  retrieval: Database,
  human: User,
  approval: Shield,
};

const stepTypeColors: Record<StepType, string> = {
  llm: "text-purple-400",
  tool: "text-blue-400",
  retrieval: "text-cyan-400",
  human: "text-orange-400",
  approval: "text-yellow-400",
};

const stepStatusIcons: Record<StepStatus, typeof CheckCircle> = {
  pending: Clock,
  running: Loader2,
  waiting_approval: Shield,
  completed: CheckCircle,
  failed: XCircle,
  skipped: Clock,
};

const stepStatusColors: Record<StepStatus, string> = {
  pending: "text-muted-foreground",
  running: "text-yellow-400",
  waiting_approval: "text-amber-400",
  completed: "text-green-400",
  failed: "text-red-400",
  skipped: "text-muted-foreground",
};

interface CompactStepCardProps {
  step: Step;
  isSelected: boolean;
  onClick: () => void;
}

function CompactStepCard({ step, isSelected, onClick }: CompactStepCardProps) {
  const TypeIcon = stepTypeIcons[step.step_type] || Wrench;
  const StatusIcon = stepStatusIcons[step.status] || Clock;
  const typeColor = stepTypeColors[step.step_type] || "text-blue-400";
  const statusColor = stepStatusColors[step.status] || "text-muted-foreground";
  const [currentTime, setCurrentTime] = useState(0);

  // Update current time for running steps
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentTime(Date.now());

    if (step.status === "running" && step.started_at && !step.completed_at) {
      const interval = setInterval(() => {
        setCurrentTime(Date.now());
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [step.status, step.started_at, step.completed_at]);

  const duration =
    step.started_at && step.completed_at
      ? new Date(step.completed_at).getTime() -
        new Date(step.started_at).getTime()
      : step.started_at && currentTime > 0
      ? currentTime - new Date(step.started_at).getTime()
      : 0;

  return (
    <div
      onClick={onClick}
      className={cn(
        "relative pl-8 py-2 px-3 rounded-md cursor-pointer transition-colors",
        isSelected
          ? "bg-accent-blue/10 border border-accent-blue/30"
          : "hover:bg-background-tertiary/50"
      )}
    >
      {/* Timeline node */}
      <div
        className={cn(
          "absolute left-1 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center bg-background border-2",
          step.status === "completed"
            ? "border-green-500"
            : step.status === "failed"
            ? "border-red-500"
            : step.status === "running"
            ? "border-yellow-500"
            : "border-border"
        )}
      >
        <TypeIcon className={cn("h-2.5 w-2.5", typeColor)} />
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">
              {step.tool_name || step.model || step.step_type}
            </span>
            {step.step_number && (
              <span className="text-[10px] text-muted-foreground font-mono">
                #{step.step_number}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {duration > 0 && <span>{formatDuration(duration)}</span>}
            {step.input_tokens && (
              <span>{step.input_tokens + (step.output_tokens || 0)} tokens</span>
            )}
          </div>
        </div>

        <StatusIcon
          className={cn(
            "h-4 w-4 shrink-0",
            statusColor,
            step.status === "running" && "animate-spin"
          )}
        />
      </div>
    </div>
  );
}
