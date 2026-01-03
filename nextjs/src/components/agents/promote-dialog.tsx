"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Rocket,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ArrowRight,
  Zap,
  Shield,
  Clock,
} from "lucide-react";
import { cn, formatDateTime } from "@/lib/utils";
import { LoadingSpinner } from "@/components/shared/loading-spinner";
import { usePromoteVersion, useEvalGateStatus } from "@/hooks/use-agents";
import type { AgentVersion, DeploymentEnvironment, EvalGateStatus } from "@/types/agent";

interface PromoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  version: AgentVersion;
}

const environmentOptions: { value: DeploymentEnvironment; label: string; description: string }[] =
  [
    {
      value: "staging",
      label: "Staging",
      description: "Test environment for validation",
    },
    {
      value: "production",
      label: "Production",
      description: "Live environment serving users",
    },
  ];

const environmentColors: Record<DeploymentEnvironment, { bg: string; text: string; border: string }> = {
  development: {
    bg: "bg-accent-blue/10",
    text: "text-accent-blue",
    border: "border-accent-blue/30",
  },
  staging: {
    bg: "bg-accent-yellow/10",
    text: "text-accent-yellow",
    border: "border-accent-yellow/30",
  },
  production: {
    bg: "bg-accent-green/10",
    text: "text-accent-green",
    border: "border-accent-green/30",
  },
};

function EvalGateCard({ gate }: { gate: EvalGateStatus }) {
  const isPassing = gate.passed;

  return (
    <div
      className={cn(
        "p-3 rounded-lg border",
        isPassing
          ? "bg-accent-green/5 border-accent-green/20"
          : "bg-accent-red/5 border-accent-red/20"
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2">
          {isPassing ? (
            <CheckCircle className="h-4 w-4 text-accent-green mt-0.5" />
          ) : (
            <XCircle className="h-4 w-4 text-accent-red mt-0.5" />
          )}
          <div>
            <p className="text-sm font-medium">{gate.suite_name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Score: {Math.round(gate.score * 100)}% (required: {Math.round(gate.required_score * 100)}
              %)
            </p>
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "text-xs",
            isPassing
              ? "bg-accent-green/10 text-accent-green border-accent-green/30"
              : "bg-accent-red/10 text-accent-red border-accent-red/30"
          )}
        >
          {isPassing ? "Passed" : "Failed"}
        </Badge>
      </div>
      {gate.completed_at && (
        <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
          <Clock className="h-3 w-3" />
          Completed {formatDateTime(gate.completed_at)}
        </p>
      )}
    </div>
  );
}

export function PromoteDialog({ open, onOpenChange, agentId, version }: PromoteDialogProps) {
  const [targetEnvironment, setTargetEnvironment] = useState<DeploymentEnvironment>("staging");
  const promoteVersionMutation = usePromoteVersion();
  const { data: evalGates, isLoading: isLoadingGates } = useEvalGateStatus(agentId, version.id);

  // Mock eval gates if API doesn't return any
  const displayGates: EvalGateStatus[] = evalGates || [
    {
      passed: true,
      suite_name: "Core Functionality",
      score: 0.95,
      required_score: 0.9,
      completed_at: new Date().toISOString(),
    },
    {
      passed: true,
      suite_name: "Safety Checks",
      score: 0.98,
      required_score: 0.95,
      completed_at: new Date().toISOString(),
    },
    {
      passed: targetEnvironment === "staging",
      suite_name: "Production Readiness",
      score: targetEnvironment === "staging" ? 0.85 : 0.92,
      required_score: 0.9,
      completed_at: new Date().toISOString(),
    },
  ];

  const allGatesPassed = displayGates.every((gate) => gate.passed);
  const canPromote = targetEnvironment === "staging" || allGatesPassed;

  const handlePromote = async () => {
    try {
      await promoteVersionMutation.mutateAsync({
        agentId,
        versionId: version.id,
        targetEnvironment,
      });
      onOpenChange(false);
    } catch {
      // Error handled by mutation
    }
  };

  // Changes since last production version (mock data)
  const changes = [
    { type: "model", description: "Updated to claude-3-opus-20240229" },
    { type: "tools", description: "Added file_search, code_interpreter" },
    { type: "prompt", description: "Refined system prompt for better accuracy" },
  ];

  const envConfig = environmentColors[targetEnvironment];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-accent-purple" />
            Promote Version
          </DialogTitle>
          <DialogDescription>
            Deploy version v{version.version} to a target environment
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-6 pr-4">
            {/* Version info */}
            <div className="p-4 rounded-lg bg-background-secondary border border-border/30">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Version</p>
                  <p className="text-2xl font-bold font-mono">v{version.version}</p>
                </div>
                <ArrowRight className="h-5 w-5 text-muted-foreground" />
                <div className="text-right">
                  <p className="text-sm font-medium">Target</p>
                  <Badge
                    variant="outline"
                    className={cn("text-lg capitalize", envConfig.bg, envConfig.text, envConfig.border)}
                  >
                    {targetEnvironment}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Environment selector */}
            <div className="space-y-2">
              <Label>Target Environment</Label>
              <Select
                value={targetEnvironment}
                onValueChange={(v) => setTargetEnvironment(v as DeploymentEnvironment)}
              >
                <SelectTrigger className="bg-background-secondary border-border/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {environmentOptions.map((env) => (
                    <SelectItem key={env.value} value={env.value}>
                      <div className="flex items-center gap-2">
                        <div
                          className={cn(
                            "h-2 w-2 rounded-full",
                            env.value === "staging" ? "bg-accent-yellow" : "bg-accent-green"
                          )}
                        />
                        <span>{env.label}</span>
                        <span className="text-muted-foreground text-xs">- {env.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Eval gates status */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-accent-purple" />
                  Eval Gate Status
                </Label>
                {allGatesPassed ? (
                  <Badge
                    variant="outline"
                    className="bg-accent-green/10 text-accent-green border-accent-green/30"
                  >
                    All Passed
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="bg-accent-red/10 text-accent-red border-accent-red/30"
                  >
                    {displayGates.filter((g) => !g.passed).length} Failed
                  </Badge>
                )}
              </div>

              {isLoadingGates ? (
                <div className="flex items-center justify-center py-6">
                  <LoadingSpinner />
                </div>
              ) : (
                <div className="space-y-2">
                  {displayGates.map((gate, index) => (
                    <EvalGateCard key={index} gate={gate} />
                  ))}
                </div>
              )}
            </div>

            {/* Changes summary */}
            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-accent-cyan" />
                Changes Since Production
              </Label>
              <div className="space-y-2">
                {changes.map((change, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-3 p-3 rounded-lg bg-background-secondary border border-border/30"
                  >
                    <div className="h-2 w-2 rounded-full bg-accent-blue" />
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">
                        {change.type}
                      </p>
                      <p className="text-sm">{change.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Warning for production */}
            {targetEnvironment === "production" && (
              <div className="rounded-lg border border-accent-yellow/30 bg-accent-yellow/10 p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-5 w-5 text-accent-yellow mt-0.5" />
                  <div>
                    <p className="font-medium text-accent-yellow">Production Deployment</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      This version will be deployed to production and serve live traffic. Ensure all
                      eval gates have passed and the version has been tested in staging.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Blocked warning if gates failed */}
            {!canPromote && (
              <div className="rounded-lg border border-accent-red/30 bg-accent-red/10 p-4">
                <div className="flex items-start gap-2">
                  <XCircle className="h-5 w-5 text-accent-red mt-0.5" />
                  <div>
                    <p className="font-medium text-accent-red">Promotion Blocked</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      One or more eval gates have failed. You must pass all eval gates to promote to
                      production. Consider testing in staging first.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handlePromote}
            disabled={!canPromote || promoteVersionMutation.isPending}
            className={cn(
              "gap-2",
              targetEnvironment === "production"
                ? "bg-accent-green hover:bg-accent-green/90"
                : "bg-accent-yellow hover:bg-accent-yellow/90 text-black"
            )}
          >
            {promoteVersionMutation.isPending ? (
              <>
                <LoadingSpinner size="sm" />
                Promoting...
              </>
            ) : (
              <>
                <Rocket className="h-4 w-4" />
                Promote to {targetEnvironment === "production" ? "Production" : "Staging"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
