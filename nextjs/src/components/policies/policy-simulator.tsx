"use client";

import { useState, useCallback } from "react";
import {
  Play,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { useAgents } from "@/hooks/use-agents";
import { useTools } from "@/hooks/use-tools";
import { useSimulatePolicy } from "@/hooks/use-policies";
import type { SimulatePolicyResponse, PolicyDecisionResult } from "@/types/policy";

const decisionConfig: Record<PolicyDecisionResult, {
  label: string;
  className: string;
  bgClassName: string;
  icon: typeof CheckCircle;
}> = {
  allowed: {
    label: "ALLOWED",
    className: "text-green-400",
    bgClassName: "bg-green-500/10 border-green-500/30",
    icon: CheckCircle,
  },
  denied: {
    label: "DENIED",
    className: "text-red-400",
    bgClassName: "bg-red-500/10 border-red-500/30",
    icon: XCircle,
  },
  approval_required: {
    label: "APPROVAL REQUIRED",
    className: "text-yellow-400",
    bgClassName: "bg-yellow-500/10 border-yellow-500/30",
    icon: AlertTriangle,
  },
};

interface SimulationResultProps {
  result: SimulatePolicyResponse;
}

function SimulationResult({ result }: SimulationResultProps) {
  const [showDetails, setShowDetails] = useState(false);
  const decision = decisionConfig[result.decision] || decisionConfig.denied;
  const DecisionIcon = decision.icon;

  return (
    <div className="space-y-4">
      {/* Main decision */}
      <Card className={cn("border-2", decision.bgClassName)}>
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <DecisionIcon className={cn("h-8 w-8", decision.className)} />
            <div>
              <h3 className={cn("text-2xl font-bold", decision.className)}>
                {decision.label}
              </h3>
              {result.matched_policy && (
                <p className="text-sm text-muted-foreground">
                  Matched policy: <span className="font-medium text-foreground">{result.matched_policy.name}</span>
                  <span className="text-xs ml-2">(Priority: {result.matched_policy.priority})</span>
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Matched rule */}
      {result.matched_rule && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Matched Rule</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge
                variant="secondary"
                className={cn(
                  "text-xs font-mono",
                  result.matched_rule.action === "allow"
                    ? "bg-green-500/20 text-green-400"
                    : result.matched_rule.action === "deny"
                    ? "bg-red-500/20 text-red-400"
                    : "bg-yellow-500/20 text-yellow-400"
                )}
              >
                {result.matched_rule.action.toUpperCase()}
              </Badge>
            </div>
            <p className="text-sm font-mono text-muted-foreground bg-muted/50 p-2 rounded">
              {result.matched_rule.condition}
            </p>
            {result.matched_rule.description && (
              <p className="text-sm text-muted-foreground">
                {result.matched_rule.description}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Explanation */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Explanation</AlertTitle>
        <AlertDescription className="mt-2 whitespace-pre-wrap">
          {result.explanation}
        </AlertDescription>
      </Alert>

      {/* Evaluated policies */}
      {result.evaluated_policies && result.evaluated_policies.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-2 text-sm font-medium hover:text-foreground transition-colors w-full"
            >
              {showDetails ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <span>Evaluation Details ({result.evaluated_policies.length} policies)</span>
            </button>
          </CardHeader>
          {showDetails && (
            <CardContent>
              <div className="space-y-2">
                {result.evaluated_policies.map((policy, index) => (
                  <div
                    key={policy.id}
                    className={cn(
                      "flex items-center justify-between py-2 px-3 rounded-md",
                      policy.result !== "not_matched" ? "bg-muted/50" : "bg-muted/20"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground font-mono">
                        #{index + 1}
                      </span>
                      <div>
                        <span className="text-sm font-medium">{policy.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          (Priority: {policy.priority})
                        </span>
                      </div>
                    </div>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "text-xs",
                        policy.result === "allowed"
                          ? "bg-green-500/20 text-green-400"
                          : policy.result === "denied"
                          ? "bg-red-500/20 text-red-400"
                          : policy.result === "approval_required"
                          ? "bg-yellow-500/20 text-yellow-400"
                          : "bg-secondary text-secondary-foreground"
                      )}
                    >
                      {policy.result === "not_matched" ? "No Match" : policy.result.toUpperCase().replace("_", " ")}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}

export function PolicySimulator() {
  const [agentId, setAgentId] = useState<string>("");
  const [toolName, setToolName] = useState<string>("");
  const [contextJson, setContextJson] = useState<string>("{\n  \n}");
  const [jsonError, setJsonError] = useState<string>("");
  const [result, setResult] = useState<SimulatePolicyResponse | null>(null);

  const { data: agents, isLoading: agentsLoading } = useAgents();
  const { data: tools, isLoading: toolsLoading } = useTools();
  const simulateMutation = useSimulatePolicy();

  const validateJson = useCallback((value: string): boolean => {
    if (!value.trim() || value.trim() === "{}") {
      setJsonError("");
      return true;
    }
    try {
      JSON.parse(value);
      setJsonError("");
      return true;
    } catch (e) {
      setJsonError((e as Error).message);
      return false;
    }
  }, []);

  const handleContextChange = (value: string) => {
    setContextJson(value);
    validateJson(value);
  };

  const handleSimulate = async () => {
    if (!validateJson(contextJson)) {
      return;
    }

    let context: Record<string, unknown> | undefined;
    if (contextJson.trim() && contextJson.trim() !== "{}") {
      try {
        context = JSON.parse(contextJson);
      } catch {
        return;
      }
    }

    const response = await simulateMutation.mutateAsync({
      agent_id: agentId || undefined,
      tool_name: toolName || undefined,
      context,
    });

    setResult(response);
  };

  const handleClear = () => {
    setAgentId("");
    setToolName("");
    setContextJson("{\n  \n}");
    setJsonError("");
    setResult(null);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Input form */}
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Simulation Parameters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Agent selector */}
            <div className="space-y-2">
              <Label htmlFor="agent">Agent (optional)</Label>
              <Select value={agentId || "__any__"} onValueChange={(val) => setAgentId(val === "__any__" ? "" : val)}>
                <SelectTrigger id="agent">
                  <SelectValue placeholder={agentsLoading ? "Loading..." : "Select an agent"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any__">Any agent</SelectItem>
                  {agents?.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Select an agent to test agent-specific policies
              </p>
            </div>

            {/* Tool selector */}
            <div className="space-y-2">
              <Label htmlFor="tool">Tool (optional)</Label>
              <Select value={toolName || "__any__"} onValueChange={(val) => setToolName(val === "__any__" ? "" : val)}>
                <SelectTrigger id="tool">
                  <SelectValue placeholder={toolsLoading ? "Loading..." : "Select a tool"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any__">Any tool</SelectItem>
                  {tools?.map((tool) => (
                    <SelectItem key={tool.id} value={tool.slug}>
                      {tool.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Select a tool to test tool-specific policies
              </p>
            </div>

            {/* Context JSON editor */}
            <div className="space-y-2">
              <Label htmlFor="context">Context (JSON)</Label>
              <Textarea
                id="context"
                value={contextJson}
                onChange={(e) => handleContextChange(e.target.value)}
                placeholder='{"key": "value"}'
                className={cn(
                  "font-mono text-sm min-h-[150px]",
                  jsonError && "border-red-500 focus-visible:border-red-500"
                )}
              />
              {jsonError ? (
                <p className="text-xs text-red-400">
                  Invalid JSON: {jsonError}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Additional context to include in policy evaluation
                </p>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 pt-2">
              <Button
                onClick={handleSimulate}
                disabled={simulateMutation.isPending || !!jsonError}
                className="flex-1"
              >
                {simulateMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Simulate
              </Button>
              <Button
                variant="outline"
                onClick={handleClear}
                disabled={simulateMutation.isPending}
              >
                Clear
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Help text */}
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>How Simulation Works</AlertTitle>
          <AlertDescription className="mt-2 text-sm space-y-2">
            <p>
              The policy simulator evaluates your policies in priority order (highest first)
              and shows which policy and rule would match for the given parameters.
            </p>
            <p>
              Leave fields empty to test general policies, or select specific agents/tools
              to test scoped policies.
            </p>
          </AlertDescription>
        </Alert>
      </div>

      {/* Results */}
      <div>
        {result ? (
          <SimulationResult result={result} />
        ) : (
          <Card className="h-full min-h-[400px] flex items-center justify-center border-dashed">
            <CardContent className="text-center">
              <Play className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">Run a Simulation</h3>
              <p className="text-sm text-muted-foreground max-w-xs">
                Configure the parameters on the left and click &quot;Simulate&quot; to see
                which policy would apply.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
