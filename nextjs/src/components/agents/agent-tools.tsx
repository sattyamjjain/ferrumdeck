"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Wrench,
  Shield,
  ShieldCheck,
  ShieldAlert,
  ShieldOff,
  Edit,
  AlertTriangle,
  Zap,
  Save,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingSpinner } from "@/components/shared/loading-spinner";
import { useUpdateAgentTools } from "@/hooks/use-agents";
import type { AgentVersion, ToolPermission } from "@/types/agent";

interface AgentToolsProps {
  agentId: string;
  version?: AgentVersion;
}

type RiskLevel = "low" | "medium" | "high" | "critical";

interface ToolEntry {
  name: string;
  permission: ToolPermission;
  riskLevel?: RiskLevel;
}

const permissionConfig: Record<
  ToolPermission,
  { label: string; icon: typeof ShieldCheck; className: string }
> = {
  allowed: {
    label: "Allowed",
    icon: ShieldCheck,
    className: "bg-accent-green/10 text-accent-green border-accent-green/30",
  },
  approval_required: {
    label: "Requires Approval",
    icon: Shield,
    className: "bg-accent-yellow/10 text-accent-yellow border-accent-yellow/30",
  },
  denied: {
    label: "Denied",
    icon: ShieldAlert,
    className: "bg-accent-red/10 text-accent-red border-accent-red/30",
  },
};

const riskConfig: Record<RiskLevel, { label: string; className: string }> = {
  low: { label: "Low", className: "bg-accent-green/10 text-accent-green border-accent-green/30" },
  medium: {
    label: "Medium",
    className: "bg-accent-yellow/10 text-accent-yellow border-accent-yellow/30",
  },
  high: {
    label: "High",
    className: "bg-accent-orange/10 text-accent-orange border-accent-orange/30",
  },
  critical: { label: "Critical", className: "bg-accent-red/10 text-accent-red border-accent-red/30" },
};

// Mock tool risk levels - in production these would come from the tool registry
function getToolRiskLevel(toolName: string): RiskLevel {
  const lowRiskTools = ["read_file", "list_files", "search", "get_info"];
  const highRiskTools = ["delete_file", "execute_command", "modify_system"];
  const criticalTools = ["admin_access", "root_command"];

  if (criticalTools.some((t) => toolName.toLowerCase().includes(t))) return "critical";
  if (highRiskTools.some((t) => toolName.toLowerCase().includes(t))) return "high";
  if (lowRiskTools.some((t) => toolName.toLowerCase().includes(t))) return "low";
  return "medium";
}

function EditToolsDialog({
  open,
  onOpenChange,
  tools,
  onSave,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tools: ToolEntry[];
  onSave: (tools: ToolEntry[]) => void;
  isPending: boolean;
}) {
  const [editedTools, setEditedTools] = useState<ToolEntry[]>(tools);

  const handlePermissionChange = (toolName: string, permission: ToolPermission) => {
    setEditedTools((prev) =>
      prev.map((tool) => (tool.name === toolName ? { ...tool, permission } : tool))
    );
  };

  const handleSave = () => {
    onSave(editedTools);
  };

  // Reset when dialog opens
  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      setEditedTools(tools);
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit className="h-5 w-5 text-accent-purple" />
            Edit Tool Permissions
          </DialogTitle>
          <DialogDescription>
            Configure which tools this agent can access and their permission levels.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-accent-yellow/30 bg-accent-yellow/10 p-3 my-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-accent-yellow mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-accent-yellow">Changes affect all future runs</p>
              <p className="text-muted-foreground text-xs mt-0.5">
                Tool permission changes will apply to all new runs using this agent version.
              </p>
            </div>
          </div>
        </div>

        <ScrollArea className="max-h-[50vh]">
          <div className="rounded-lg border border-border/30 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-background-secondary/50 hover:bg-background-secondary/50">
                  <TableHead className="text-xs uppercase tracking-wider font-medium">
                    Tool
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider font-medium">
                    Risk
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider font-medium">
                    Permission
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {editedTools.map((tool) => {
                  const risk = riskConfig[tool.riskLevel || "medium"];
                  return (
                    <TableRow key={tool.name} className="hover:bg-background-secondary/30">
                      <TableCell className="font-mono text-sm">{tool.name}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn("text-xs capitalize", risk.className)}
                        >
                          {risk.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={tool.permission}
                          onValueChange={(value) =>
                            handlePermissionChange(tool.name, value as ToolPermission)
                          }
                        >
                          <SelectTrigger className="w-[180px] h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="allowed">
                              <div className="flex items-center gap-2">
                                <ShieldCheck className="h-3 w-3 text-accent-green" />
                                Allowed
                              </div>
                            </SelectItem>
                            <SelectItem value="approval_required">
                              <div className="flex items-center gap-2">
                                <Shield className="h-3 w-3 text-accent-yellow" />
                                Requires Approval
                              </div>
                            </SelectItem>
                            <SelectItem value="denied">
                              <div className="flex items-center gap-2">
                                <ShieldAlert className="h-3 w-3 text-accent-red" />
                                Denied
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isPending} className="gap-2">
            {isPending ? (
              <>
                <LoadingSpinner size="sm" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Save Changes
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AgentTools({ agentId, version }: AgentToolsProps) {
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const updateToolsMutation = useUpdateAgentTools();

  // Build tools list from version
  const tools: ToolEntry[] = [
    ...(version?.allowed_tools?.map((name) => ({
      name,
      permission: "allowed" as ToolPermission,
      riskLevel: getToolRiskLevel(name),
    })) || []),
    ...(version?.approval_tools?.map((name) => ({
      name,
      permission: "approval_required" as ToolPermission,
      riskLevel: getToolRiskLevel(name),
    })) || []),
    ...(version?.denied_tools?.map((name) => ({
      name,
      permission: "denied" as ToolPermission,
      riskLevel: getToolRiskLevel(name),
    })) || []),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const handleSaveTools = async (updatedTools: ToolEntry[]) => {
    if (!version) return;

    const allowed_tools = updatedTools
      .filter((t) => t.permission === "allowed")
      .map((t) => t.name);
    const approval_tools = updatedTools
      .filter((t) => t.permission === "approval_required")
      .map((t) => t.name);
    const denied_tools = updatedTools
      .filter((t) => t.permission === "denied")
      .map((t) => t.name);

    try {
      await updateToolsMutation.mutateAsync({
        agentId,
        versionId: version.id,
        tools: { allowed_tools, approval_tools, denied_tools },
      });
      setEditDialogOpen(false);
    } catch {
      // Error handled by mutation
    }
  };

  if (!version) {
    return (
      <Card className="bg-card/50 border-border/50">
        <CardContent className="py-12">
          <EmptyState
            icon={Wrench}
            title="No Version Selected"
            description="This agent needs a version to configure tools."
            variant="compact"
          />
        </CardContent>
      </Card>
    );
  }

  if (tools.length === 0) {
    return (
      <Card className="bg-card/50 border-border/50">
        <CardContent className="py-12">
          <EmptyState
            icon={Wrench}
            title="No Tools Configured"
            description="This agent version has no tool permissions configured. Add tools to allow the agent to perform actions."
            variant="compact"
            actionLabel="Configure Tools"
            onAction={() => setEditDialogOpen(true)}
          />
        </CardContent>
      </Card>
    );
  }

  const allowedCount = tools.filter((t) => t.permission === "allowed").length;
  const approvalCount = tools.filter((t) => t.permission === "approval_required").length;
  const deniedCount = tools.filter((t) => t.permission === "denied").length;

  return (
    <>
      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-background-secondary flex items-center justify-center">
                <Wrench className="h-5 w-5 text-accent-cyan" />
              </div>
              <div>
                <CardTitle className="text-base">Tool Permissions</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  {tools.length} tool{tools.length !== 1 ? "s" : ""} configured for version v
                  {version.version}
                </CardDescription>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => setEditDialogOpen(true)}
            >
              <Edit className="h-3 w-3" />
              Edit Permissions
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-accent-green/5 border border-accent-green/20">
              <div className="flex items-center gap-2 text-accent-green">
                <ShieldCheck className="h-4 w-4" />
                <span className="text-sm font-medium">Allowed</span>
              </div>
              <p className="text-2xl font-bold mt-1">{allowedCount}</p>
            </div>
            <div className="p-4 rounded-lg bg-accent-yellow/5 border border-accent-yellow/20">
              <div className="flex items-center gap-2 text-accent-yellow">
                <Shield className="h-4 w-4" />
                <span className="text-sm font-medium">Approval</span>
              </div>
              <p className="text-2xl font-bold mt-1">{approvalCount}</p>
            </div>
            <div className="p-4 rounded-lg bg-accent-red/5 border border-accent-red/20">
              <div className="flex items-center gap-2 text-accent-red">
                <ShieldOff className="h-4 w-4" />
                <span className="text-sm font-medium">Denied</span>
              </div>
              <p className="text-2xl font-bold mt-1">{deniedCount}</p>
            </div>
          </div>

          {/* Tools table */}
          <div className="rounded-lg border border-border/30 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-background-secondary/50 hover:bg-background-secondary/50">
                  <TableHead className="text-xs uppercase tracking-wider font-medium">
                    Tool Name
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider font-medium">
                    Risk Level
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider font-medium">
                    Permission
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tools.map((tool) => {
                  const perm = permissionConfig[tool.permission];
                  const risk = riskConfig[tool.riskLevel || "medium"];
                  const PermIcon = perm.icon;

                  return (
                    <TableRow key={tool.name} className="hover:bg-background-secondary/30">
                      <TableCell className="font-mono text-sm">{tool.name}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn("text-xs capitalize", risk.className)}
                        >
                          {risk.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("gap-1.5", perm.className)}>
                          <PermIcon className="h-3 w-3" />
                          {perm.label}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Security note */}
          <div className="rounded-lg border border-border/30 bg-background-secondary/30 p-4">
            <div className="flex items-start gap-3">
              <Zap className="h-5 w-5 text-accent-purple mt-0.5" />
              <div>
                <p className="text-sm font-medium">Deny-by-Default Security</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Tools not explicitly listed here are automatically denied. High-risk and critical
                  tools should use approval-required permission to ensure human oversight.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <EditToolsDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        tools={tools}
        onSave={handleSaveTools}
        isPending={updateToolsMutation.isPending}
      />
    </>
  );
}
