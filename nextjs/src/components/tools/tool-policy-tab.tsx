"use client";

import { useState } from "react";
import {
  Shield,
  CheckCircle,
  XCircle,
  HelpCircle,
  DollarSign,
  Clock,
  AlertTriangle,
  Bot,
  Trash2,
  Plus,
  Save,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LoadingSpinner } from "@/components/shared/loading-spinner";
import { EmptyRow } from "@/components/shared/empty-state";
import { useUpdateToolPolicy } from "@/hooks/use-tools";
import { cn, formatCost, formatTimeAgo } from "@/lib/utils";
import type { ToolDetail, ToolDefaultPolicy, ToolAgentOverride } from "@/types/tool";

// Policy options
const policyOptions: Array<{ value: ToolDefaultPolicy; label: string; description: string; icon: typeof CheckCircle }> = [
  {
    value: "allowed",
    label: "Allowed",
    description: "Tool can be used without restrictions",
    icon: CheckCircle,
  },
  {
    value: "denied",
    label: "Denied",
    description: "Tool cannot be used by any agent",
    icon: XCircle,
  },
  {
    value: "approval_required",
    label: "Approval Required",
    description: "Each use requires human approval",
    icon: HelpCircle,
  },
];

interface ToolPolicyTabProps {
  toolId: string;
  tool: ToolDetail;
}

export function ToolPolicyTab({ toolId, tool }: ToolPolicyTabProps) {
  const updateMutation = useUpdateToolPolicy(toolId);

  // Form state
  const [defaultPolicy, setDefaultPolicy] = useState<ToolDefaultPolicy>(
    tool.policy?.default_policy || "denied"
  );
  const [budgetLimit, setBudgetLimit] = useState<string>(
    tool.policy?.budget_limit_cents ? String(tool.policy.budget_limit_cents / 100) : ""
  );
  const [rateLimit, setRateLimit] = useState<string>(
    tool.policy?.rate_limit_per_minute ? String(tool.policy.rate_limit_per_minute) : ""
  );
  const [requiresJustification, setRequiresJustification] = useState(
    tool.policy?.requires_justification || false
  );
  const [allowedScopes, setAllowedScopes] = useState<string>(
    tool.policy?.allowed_scopes?.join(", ") || ""
  );

  const [hasChanges, setHasChanges] = useState(false);

  const handleSave = async () => {
    await updateMutation.mutateAsync({
      default_policy: defaultPolicy,
      budget_limit_cents: budgetLimit ? Math.round(parseFloat(budgetLimit) * 100) : undefined,
      rate_limit_per_minute: rateLimit ? parseInt(rateLimit, 10) : undefined,
      requires_justification: requiresJustification,
      allowed_scopes: allowedScopes ? allowedScopes.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    });
    setHasChanges(false);
  };

  const handleChange = () => {
    setHasChanges(true);
  };

  return (
    <div className="space-y-6">
      {/* Default Policy Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm">Default Policy</CardTitle>
              <CardDescription>
                Configure the default behavior for this tool across all agents
              </CardDescription>
            </div>
            {hasChanges && (
              <Button
                onClick={handleSave}
                disabled={updateMutation.isPending}
                className="bg-accent-green hover:bg-accent-green/90"
              >
                {updateMutation.isPending ? (
                  <>
                    <LoadingSpinner size="sm" className="mr-2" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Save Changes
                  </>
                )}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Policy Selection */}
          <div className="space-y-3">
            <Label>Default Access Policy</Label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {policyOptions.map((option) => {
                const Icon = option.icon;
                const isSelected = defaultPolicy === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setDefaultPolicy(option.value);
                      handleChange();
                    }}
                    className={cn(
                      "p-4 rounded-lg border text-left transition-all",
                      isSelected
                        ? "border-accent-blue bg-accent-blue/10"
                        : "border-border hover:border-border-hover hover:bg-background-tertiary"
                    )}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Icon
                        className={cn(
                          "h-5 w-5",
                          option.value === "allowed" && "text-accent-green",
                          option.value === "denied" && "text-accent-red",
                          option.value === "approval_required" && "text-accent-yellow"
                        )}
                      />
                      <span className="font-medium">{option.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{option.description}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Requires Justification */}
          <div className="flex items-center justify-between p-4 rounded-lg bg-background-secondary">
            <div className="space-y-0.5">
              <Label htmlFor="justification">Require Justification</Label>
              <p className="text-xs text-muted-foreground">
                Agents must provide a reason for each tool call
              </p>
            </div>
            <Switch
              id="justification"
              checked={requiresJustification}
              onCheckedChange={(checked) => {
                setRequiresJustification(checked);
                handleChange();
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Budget Constraints */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Budget Constraints</CardTitle>
          <CardDescription>
            Set limits on tool usage to prevent runaway costs
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Budget Limit */}
            <div className="space-y-2">
              <Label htmlFor="budget">Budget Limit (per run)</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="budget"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="No limit"
                  value={budgetLimit}
                  onChange={(e) => {
                    setBudgetLimit(e.target.value);
                    handleChange();
                  }}
                  className="pl-9 bg-background-secondary"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Maximum cost allowed per run in USD
              </p>
            </div>

            {/* Rate Limit */}
            <div className="space-y-2">
              <Label htmlFor="rate">Rate Limit (per minute)</Label>
              <div className="relative">
                <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="rate"
                  type="number"
                  min="0"
                  placeholder="No limit"
                  value={rateLimit}
                  onChange={(e) => {
                    setRateLimit(e.target.value);
                    handleChange();
                  }}
                  className="pl-9 bg-background-secondary"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Maximum calls allowed per minute
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Allowed Scopes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Allowed Scopes</CardTitle>
          <CardDescription>
            Restrict which permissions this tool can use (comma-separated)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Input
              placeholder="read:files, write:config, ..."
              value={allowedScopes}
              onChange={(e) => {
                setAllowedScopes(e.target.value);
                handleChange();
              }}
              className="bg-background-secondary font-mono text-sm"
            />
            {allowedScopes && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {allowedScopes.split(",").map((scope, i) => {
                  const trimmed = scope.trim();
                  if (!trimmed) return null;
                  return (
                    <Badge key={i} variant="outline" className="font-mono text-xs">
                      {trimmed}
                    </Badge>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Per-Agent Overrides */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm">Per-Agent Overrides</CardTitle>
              <CardDescription>
                Configure specific policies for individual agents
              </CardDescription>
            </div>
            <Button variant="outline" size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Override
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Agent</TableHead>
                <TableHead className="w-[150px]">Policy</TableHead>
                <TableHead className="w-[120px]">Budget</TableHead>
                <TableHead className="w-[140px]">Updated</TableHead>
                <TableHead className="w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!tool.agent_overrides || tool.agent_overrides.length === 0 ? (
                <EmptyRow colSpan={5} message="No agent-specific overrides" />
              ) : (
                tool.agent_overrides.map((override) => (
                  <OverrideRow key={override.agent_id} override={override} />
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Warning for Critical Tools */}
      {tool.risk_level === "critical" && (
        <Card className="border-accent-red/30 bg-accent-red/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-accent-red mt-0.5" />
              <div>
                <h4 className="font-medium text-accent-red">Critical Risk Tool</h4>
                <p className="text-sm text-muted-foreground mt-1">
                  This tool is classified as critical risk. Consider enabling approval requirements
                  and setting strict budget limits to prevent unintended consequences.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface OverrideRowProps {
  override: ToolAgentOverride;
}

function OverrideRow({ override }: OverrideRowProps) {
  const policyConfig = {
    allowed: { label: "Allowed", className: "bg-accent-green/15 text-accent-green" },
    denied: { label: "Denied", className: "bg-accent-red/15 text-accent-red" },
    approval_required: { label: "Approval", className: "bg-accent-yellow/15 text-accent-yellow" },
  };

  const config = policyConfig[override.policy];

  return (
    <TableRow className="group">
      <TableCell>
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-accent-purple" />
          <span className="font-medium">{override.agent_name}</span>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="secondary" className={cn("text-xs", config.className)}>
          {config.label}
        </Badge>
      </TableCell>
      <TableCell>
        {override.budget_limit_cents ? (
          <span className="text-sm font-mono">{formatCost(override.budget_limit_cents)}</span>
        ) : (
          <span className="text-sm text-muted-foreground">-</span>
        )}
      </TableCell>
      <TableCell>
        <span className="text-sm text-muted-foreground">
          {formatTimeAgo(override.updated_at)}
        </span>
      </TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}
