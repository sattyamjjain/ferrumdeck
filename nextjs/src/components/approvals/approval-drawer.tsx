"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Shield,
  Clock,
  ExternalLink,
  Check,
  X,
  Loader2,
  FileText,
  User,
  Bot,
  History,
  ChevronRight,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { JsonViewer } from "@/components/shared/json-viewer";
import { useApprovals, useApproveAction, useRejectAction } from "@/hooks/use-approvals";
import {
  formatTimeAgo,
  formatDateTime,
  truncateId,
  cn,
  getRiskLevelColor,
  getRiskLevelBgColor,
} from "@/lib/utils";
import type { ApprovalRequest } from "@/types/approval";
import type { RiskLevel } from "@/lib/utils";

interface ApprovalDrawerProps {
  approval: ApprovalRequest | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getRiskLevelFromApproval(approval: ApprovalRequest): RiskLevel {
  // Use the risk_level from the approval if available, otherwise derive from action type
  if (approval.risk_level) {
    return approval.risk_level;
  }
  // Default risk level inference based on action type or tool name
  const actionLower = (approval.action_type || approval.tool_name || "").toLowerCase();
  if (
    actionLower.includes("delete") ||
    actionLower.includes("drop") ||
    actionLower.includes("destroy")
  ) {
    return "critical";
  }
  if (
    actionLower.includes("write") ||
    actionLower.includes("update") ||
    actionLower.includes("modify")
  ) {
    return "high";
  }
  if (actionLower.includes("execute") || actionLower.includes("run")) {
    return "medium";
  }
  return "low";
}

function RiskBadge({ level }: { level: RiskLevel }) {
  const colorClass = getRiskLevelColor(level);
  const bgClass = getRiskLevelBgColor(level);

  return (
    <Badge
      variant="outline"
      className={cn("text-xs font-semibold uppercase border", colorClass, bgClass)}
    >
      {level}
    </Badge>
  );
}

function WaitingDuration({ createdAt }: { createdAt: string }) {
  const [, setTick] = useState(0);

  // Update every second for real-time display
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const created = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);

  if (diffHours > 0) {
    return (
      <span className="text-accent-orange">
        Waiting {diffHours}h {diffMinutes % 60}m
      </span>
    );
  }
  if (diffMinutes > 0) {
    return (
      <span className="text-accent-yellow">
        Waiting {diffMinutes}m {diffSeconds % 60}s
      </span>
    );
  }
  return <span className="text-accent-green">Waiting {diffSeconds}s</span>;
}

function SimilarApprovalItem({
  approval,
}: {
  approval: ApprovalRequest;
}) {
  const statusColor =
    approval.status === "approved"
      ? "text-accent-green"
      : approval.status === "rejected"
        ? "text-accent-red"
        : "text-muted-foreground";

  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-md bg-background-secondary/50 hover:bg-background-secondary transition-colors">
      <div className="flex items-center gap-2 min-w-0">
        <div
          className={cn(
            "w-2 h-2 rounded-full flex-shrink-0",
            approval.status === "approved"
              ? "bg-accent-green"
              : approval.status === "rejected"
                ? "bg-accent-red"
                : "bg-muted-foreground"
          )}
        />
        <span className="text-sm truncate">
          {approval.tool_name || approval.action_type}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={cn("text-xs capitalize", statusColor)}>
          {approval.status}
        </span>
        {approval.resolved_at && (
          <span className="text-xs text-muted-foreground">
            {formatTimeAgo(approval.resolved_at)}
          </span>
        )}
      </div>
    </div>
  );
}

export function ApprovalDrawer({
  approval,
  open,
  onOpenChange,
}: ApprovalDrawerProps) {
  const [comment, setComment] = useState("");
  const [denyReason, setDenyReason] = useState("");
  const [showDenyInput, setShowDenyInput] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const approveMutation = useApproveAction();
  const rejectMutation = useRejectAction();
  const { data: allApprovals } = useApprovals();

  // Get similar approvals (same tool, resolved recently)
  const similarApprovals = useMemo(() => {
    if (!approval || !allApprovals) return [];
    return allApprovals
      .filter(
        (a) =>
          a.id !== approval.id &&
          (a.tool_name === approval.tool_name ||
            a.action_type === approval.action_type) &&
          a.status !== "pending"
      )
      .slice(0, 5);
  }, [approval, allApprovals]);

  if (!approval) return null;

  const riskLevel = getRiskLevelFromApproval(approval);
  const isHighRisk = riskLevel === "high" || riskLevel === "critical";
  const isPending = approval.status === "pending";
  const isExpired =
    approval.expires_at && new Date(approval.expires_at) < new Date();
  const isActing = approveMutation.isPending || rejectMutation.isPending;

  const handleApprove = () => {
    if (isHighRisk) {
      setShowConfirmDialog(true);
    } else {
      executeApprove();
    }
  };

  const executeApprove = () => {
    approveMutation.mutate(
      { approvalId: approval.id, note: comment || undefined },
      {
        onSuccess: () => {
          setComment("");
          setShowConfirmDialog(false);
          onOpenChange(false);
        },
      }
    );
  };

  const handleDeny = () => {
    if (!showDenyInput) {
      setShowDenyInput(true);
      return;
    }

    if (!denyReason.trim()) {
      return; // Reason is required
    }

    rejectMutation.mutate(
      { approvalId: approval.id, note: denyReason },
      {
        onSuccess: () => {
          setDenyReason("");
          setShowDenyInput(false);
          onOpenChange(false);
        },
      }
    );
  };

  const handleClose = () => {
    setComment("");
    setDenyReason("");
    setShowDenyInput(false);
    onOpenChange(false);
  };

  // Generate "what will happen" description
  const whatWillHappen = useMemo(() => {
    const toolName = approval.tool_name || approval.action_type || "action";
    const details = approval.action_details;

    if (details.file_path) {
      return `The agent will execute "${toolName}" on file: ${details.file_path}`;
    }
    if (details.command) {
      return `The agent will run command: ${details.command}`;
    }
    if (details.url) {
      return `The agent will access: ${details.url}`;
    }
    if (details.query) {
      return `The agent will execute database query`;
    }

    return `The agent will perform the "${toolName}" action with the specified parameters`;
  }, [approval]);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-[600px] p-0 flex flex-col"
        >
          <SheetHeader className="px-6 pt-6 pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent-purple/10 border border-accent-purple/20">
                <Shield className="h-5 w-5 text-accent-purple" />
              </div>
              <div className="flex-1 min-w-0">
                <SheetTitle className="text-lg font-semibold truncate">
                  {approval.tool_name || approval.action_type || "Action Approval"}
                </SheetTitle>
                <SheetDescription className="text-sm text-muted-foreground">
                  Review and approve this action request
                </SheetDescription>
              </div>
              <RiskBadge level={riskLevel} />
            </div>
          </SheetHeader>

          <ScrollArea className="flex-1 overflow-hidden">
            <div className="px-6 py-4 space-y-6">
              {/* High Risk Warning Banner */}
              {isHighRisk && isPending && !isExpired && (
                <Alert
                  className={cn(
                    "border",
                    riskLevel === "critical"
                      ? "bg-accent-red/10 border-accent-red/30"
                      : "bg-accent-orange/10 border-accent-orange/30"
                  )}
                >
                  <AlertTriangle
                    className={cn(
                      "h-4 w-4",
                      riskLevel === "critical"
                        ? "text-accent-red"
                        : "text-accent-orange"
                    )}
                  />
                  <AlertTitle
                    className={
                      riskLevel === "critical"
                        ? "text-accent-red"
                        : "text-accent-orange"
                    }
                  >
                    {riskLevel === "critical" ? "Critical Risk Action" : "High Risk Action"}
                  </AlertTitle>
                  <AlertDescription
                    className={
                      riskLevel === "critical"
                        ? "text-accent-red/80"
                        : "text-accent-orange/80"
                    }
                  >
                    This action requires careful review. Please verify the payload
                    and impact before approving.
                  </AlertDescription>
                </Alert>
              )}

              {/* What Will Happen */}
              <div className="space-y-2">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  What will happen if approved
                </h3>
                <div className="p-3 rounded-lg bg-background-secondary border border-border">
                  <p className="text-sm text-foreground">{whatWillHappen}</p>
                </div>
              </div>

              {/* Full Payload */}
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Action Payload</h3>
                <JsonViewer
                  data={approval.action_details}
                  collapsed={1}
                  maxHeight={250}
                  className="text-xs"
                />
              </div>

              {/* Why Approval is Required */}
              <div className="space-y-2">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  Why approval is required
                </h3>
                <div className="p-3 rounded-lg bg-background-secondary border border-border space-y-2">
                  {approval.policy_name && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Policy:</span>
                      <Badge variant="secondary" className="text-xs">
                        {approval.policy_name}
                      </Badge>
                    </div>
                  )}
                  {approval.policy_rule && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Rule:</span>
                      <span className="text-sm font-mono">{approval.policy_rule}</span>
                    </div>
                  )}
                  {approval.reason && (
                    <div className="pt-1">
                      <p className="text-sm">{approval.reason}</p>
                    </div>
                  )}
                  {!approval.policy_name && !approval.policy_rule && !approval.reason && (
                    <p className="text-sm text-muted-foreground">
                      This action requires manual approval based on the configured
                      security policies.
                    </p>
                  )}
                </div>
              </div>

              {/* Requester Context */}
              <div className="space-y-2">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  Requester Context
                </h3>
                <div className="grid gap-3">
                  {/* Agent Info */}
                  <div className="flex items-center justify-between p-3 rounded-lg bg-background-secondary border border-border">
                    <div className="flex items-center gap-2">
                      <Bot className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Agent:</span>
                    </div>
                    {approval.agent_id ? (
                      <Link
                        href={`/agents/${approval.agent_id}`}
                        className="text-sm text-accent-blue hover:underline flex items-center gap-1"
                      >
                        {approval.agent_name || truncateId(approval.agent_id)}
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    ) : (
                      <span className="text-sm text-muted-foreground">Unknown</span>
                    )}
                  </div>

                  {/* Run Info */}
                  <div className="flex items-center justify-between p-3 rounded-lg bg-background-secondary border border-border">
                    <div className="flex items-center gap-2">
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Run:</span>
                    </div>
                    <Link
                      href={`/runs/${approval.run_id}`}
                      className="text-sm font-mono text-accent-blue hover:underline flex items-center gap-1"
                    >
                      {truncateId(approval.run_id)}
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>

                  {/* Step Info */}
                  {approval.step_number !== undefined && (
                    <div className="flex items-center justify-between p-3 rounded-lg bg-background-secondary border border-border">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Step:</span>
                      </div>
                      <span className="text-sm font-mono">
                        #{approval.step_number}
                      </span>
                    </div>
                  )}

                  {/* Timing */}
                  <div className="flex items-center justify-between p-3 rounded-lg bg-background-secondary border border-border">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Requested:</span>
                    </div>
                    <span className="text-sm">
                      {formatDateTime(approval.created_at)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Similar Approvals */}
              {similarApprovals.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    <History className="h-4 w-4 text-muted-foreground" />
                    Recent similar approvals
                  </h3>
                  <div className="space-y-1">
                    {similarApprovals.map((similar) => (
                      <SimilarApprovalItem key={similar.id} approval={similar} />
                    ))}
                  </div>
                </div>
              )}

              {/* Comment Input */}
              {isPending && !isExpired && (
                <div className="space-y-2">
                  <Label htmlFor="comment" className="text-sm font-medium">
                    Comment (optional)
                  </Label>
                  <Textarea
                    id="comment"
                    placeholder="Add a note about your decision..."
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={2}
                    className="resize-none"
                  />
                </div>
              )}

              {/* Deny Reason Input */}
              {showDenyInput && isPending && !isExpired && (
                <div className="space-y-2">
                  <Label htmlFor="denyReason" className="text-sm font-medium">
                    Denial reason <span className="text-accent-red">*</span>
                  </Label>
                  <Textarea
                    id="denyReason"
                    placeholder="Explain why this request is being denied..."
                    value={denyReason}
                    onChange={(e) => setDenyReason(e.target.value)}
                    rows={2}
                    className={cn(
                      "resize-none",
                      !denyReason.trim() && "border-accent-red/50 focus:border-accent-red"
                    )}
                  />
                  {!denyReason.trim() && (
                    <p className="text-xs text-accent-red">
                      A reason is required when denying a request
                    </p>
                  )}
                </div>
              )}

              {/* Resolution Details (for resolved approvals) */}
              {!isPending && (
                <div className="space-y-2">
                  <Separator />
                  <div className="p-3 rounded-lg bg-background-secondary border border-border space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Status:</span>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-xs",
                          approval.status === "approved"
                            ? "bg-accent-green/20 text-accent-green"
                            : approval.status === "rejected"
                              ? "bg-accent-red/20 text-accent-red"
                              : "bg-muted text-muted-foreground"
                        )}
                      >
                        {approval.status}
                      </Badge>
                    </div>
                    {approval.resolved_by && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Resolved by:</span>
                        <span className="text-sm">{approval.resolved_by}</span>
                      </div>
                    )}
                    {approval.resolved_at && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Resolved at:</span>
                        <span className="text-sm">{formatDateTime(approval.resolved_at)}</span>
                      </div>
                    )}
                    {approval.resolution_note && (
                      <div className="pt-1">
                        <span className="text-sm text-muted-foreground">Note:</span>
                        <p className="text-sm mt-1">{approval.resolution_note}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Footer Actions */}
          {isPending && !isExpired && (
            <SheetFooter className="px-6 py-4 border-t border-border bg-background-secondary/30">
              <div className="flex items-center justify-between w-full gap-3">
                <div className="flex items-center text-sm text-muted-foreground">
                  <Clock className="h-4 w-4 mr-1.5" />
                  <WaitingDuration createdAt={approval.created_at} />
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClose}
                    disabled={isActing}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDeny}
                    disabled={isActing || (showDenyInput && !denyReason.trim())}
                  >
                    {rejectMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <X className="h-4 w-4 mr-1" />
                        {showDenyInput ? "Confirm Deny" : "Deny"}
                      </>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleApprove}
                    disabled={isActing}
                    className={cn(
                      "bg-accent-green hover:bg-accent-green/90 text-white",
                      isHighRisk && "bg-accent-orange hover:bg-accent-orange/90"
                    )}
                  >
                    {approveMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Check className="h-4 w-4 mr-1" />
                        Approve
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </SheetFooter>
          )}
        </SheetContent>
      </Sheet>

      {/* High Risk Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle
                className={cn(
                  "h-5 w-5",
                  riskLevel === "critical" ? "text-accent-red" : "text-accent-orange"
                )}
              />
              Confirm {riskLevel.toUpperCase()} Risk Approval
            </AlertDialogTitle>
            <AlertDialogDescription>
              You are about to approve a{" "}
              <span
                className={cn(
                  "font-semibold",
                  riskLevel === "critical" ? "text-accent-red" : "text-accent-orange"
                )}
              >
                {riskLevel.toUpperCase()} RISK
              </span>{" "}
              action. This action may have significant consequences. Are you sure you
              want to proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="my-4 p-3 rounded-lg bg-background-secondary border border-border">
            <p className="text-sm font-medium mb-1">Action:</p>
            <p className="text-sm text-muted-foreground">
              {approval.tool_name || approval.action_type}
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={approveMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={executeApprove}
              disabled={approveMutation.isPending}
              className={cn(
                "text-white",
                riskLevel === "critical"
                  ? "bg-accent-red hover:bg-accent-red/90"
                  : "bg-accent-orange hover:bg-accent-orange/90"
              )}
            >
              {approveMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              Yes, Approve
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
