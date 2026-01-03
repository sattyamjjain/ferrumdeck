"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  Shield,
  Clock,
  ExternalLink,
  Check,
  X,
  Loader2,
  Eye,
  Bot,
  FileCode,
} from "lucide-react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useApproveAction, useRejectAction } from "@/hooks/use-approvals";
import {
  formatTimeAgo,
  truncateId,
  cn,
  getRiskLevelColor,
  getRiskLevelBgColor,
} from "@/lib/utils";
import type { ApprovalRequest } from "@/types/approval";
import type { RiskLevel } from "@/lib/utils";

interface ApprovalCardProps {
  approval: ApprovalRequest;
  onViewDetails?: (approval: ApprovalRequest) => void;
}

function getRiskLevelFromApproval(approval: ApprovalRequest): RiskLevel {
  if (approval.risk_level) {
    return approval.risk_level;
  }
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
      className={cn(
        "text-[10px] font-semibold uppercase border px-1.5 py-0",
        colorClass,
        bgClass
      )}
    >
      {level}
    </Badge>
  );
}

function WaitingDuration({ createdAt }: { createdAt: string }) {
  const created = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);

  if (diffHours > 0) {
    const remainingMinutes = diffMinutes % 60;
    return `${diffHours}h ${remainingMinutes}m`;
  }
  if (diffMinutes > 0) {
    return `${diffMinutes} minute${diffMinutes !== 1 ? "s" : ""}`;
  }
  return `${diffSeconds}s`;
}

function PayloadPreview({
  payload,
  maxLines = 3,
}: {
  payload: Record<string, unknown>;
  maxLines?: number;
}) {
  const preview = useMemo(() => {
    try {
      const formatted = JSON.stringify(payload, null, 2);
      const lines = formatted.split("\n");
      if (lines.length <= maxLines) {
        return { text: formatted, truncated: false };
      }
      return {
        text: lines.slice(0, maxLines).join("\n") + "\n...",
        truncated: true,
      };
    } catch {
      return { text: "{}", truncated: false };
    }
  }, [payload, maxLines]);

  return (
    <pre className="text-[11px] font-mono text-muted-foreground bg-background-secondary/50 rounded p-2 overflow-hidden">
      {preview.text}
    </pre>
  );
}

export function ApprovalCard({ approval, onViewDetails }: ApprovalCardProps) {
  const [note, setNote] = useState("");
  const [showNoteInput, setShowNoteInput] = useState(false);
  const approveMutation = useApproveAction();
  const rejectMutation = useRejectAction();

  const isPending = approval.status === "pending";
  const isExpired = approval.expires_at && new Date(approval.expires_at) < new Date();
  const riskLevel = getRiskLevelFromApproval(approval);

  const handleApprove = () => {
    approveMutation.mutate(
      { approvalId: approval.id, note: note || undefined },
      {
        onSuccess: () => {
          setNote("");
          setShowNoteInput(false);
        },
      }
    );
  };

  const handleReject = () => {
    rejectMutation.mutate(
      { approvalId: approval.id, note: note || undefined },
      {
        onSuccess: () => {
          setNote("");
          setShowNoteInput(false);
        },
      }
    );
  };

  const isActing = approveMutation.isPending || rejectMutation.isPending;

  // Status-based left border color
  const borderColor = isPending && !isExpired
    ? riskLevel === "critical"
      ? "border-l-accent-red"
      : riskLevel === "high"
        ? "border-l-accent-orange"
        : "border-l-purple-500"
    : approval.status === "approved"
      ? "border-l-accent-green"
      : approval.status === "rejected"
        ? "border-l-accent-red"
        : "border-l-muted";

  return (
    <Card
      className={cn(
        "border-l-4 transition-all duration-200 hover:shadow-md",
        borderColor,
        isPending && !isExpired && "animate-fade-in"
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Shield className="h-4 w-4 text-purple-400 flex-shrink-0" />
            <span className="font-medium truncate">
              {approval.tool_name || approval.action_type || "Action"}
            </span>
            <RiskBadge level={riskLevel} />
            {!isPending && (
              <Badge
                variant="secondary"
                className={cn(
                  "text-xs",
                  approval.status === "approved"
                    ? "bg-accent-green/20 text-accent-green"
                    : approval.status === "rejected"
                      ? "bg-accent-red/20 text-accent-red"
                      : "bg-secondary"
                )}
              >
                {isExpired ? "Expired" : approval.status}
              </Badge>
            )}
          </div>
          {onViewDetails && isPending && !isExpired && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs flex-shrink-0"
              onClick={() => onViewDetails(approval)}
            >
              <Eye className="h-3.5 w-3.5 mr-1" />
              View Details
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pb-3">
        {/* Meta info row */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {/* Run ID link */}
          <Link
            href={`/runs/${approval.run_id}`}
            className="flex items-center gap-1 hover:text-accent-blue transition-colors"
          >
            <FileCode className="h-3 w-3" />
            <span className="font-mono">{truncateId(approval.run_id, 10)}</span>
            <ExternalLink className="h-2.5 w-2.5" />
          </Link>

          {/* Agent name/id */}
          {(approval.agent_name || approval.agent_id) && (
            <Link
              href={`/agents/${approval.agent_id || ""}`}
              className="flex items-center gap-1 hover:text-accent-blue transition-colors"
            >
              <Bot className="h-3 w-3" />
              <span>{approval.agent_name || truncateId(approval.agent_id || "", 10)}</span>
            </Link>
          )}

          {/* Waiting duration */}
          {isPending && !isExpired && (
            <span className="flex items-center gap-1 text-accent-yellow">
              <Clock className="h-3 w-3" />
              Waiting <WaitingDuration createdAt={approval.created_at} />
            </span>
          )}

          {/* Created time for resolved */}
          {!isPending && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatTimeAgo(approval.created_at)}
            </span>
          )}

          {/* Expiry warning */}
          {approval.expires_at && !isExpired && isPending && (
            <span className="text-accent-orange">
              Expires: {formatTimeAgo(approval.expires_at)}
            </span>
          )}
        </div>

        {/* Policy trigger */}
        {(approval.policy_name || approval.reason) && (
          <div className="text-xs">
            <span className="text-muted-foreground">Policy: </span>
            <span className="text-foreground">
              {approval.policy_name || approval.reason}
            </span>
          </div>
        )}

        {/* Payload preview */}
        {approval.action_details && Object.keys(approval.action_details).length > 0 && (
          <PayloadPreview payload={approval.action_details} maxLines={3} />
        )}

        {/* Resolution note for resolved approvals */}
        {approval.resolution_note && (
          <div className="text-sm bg-background-secondary/50 rounded p-2">
            <span className="text-muted-foreground text-xs">Note: </span>
            <span className="text-foreground text-xs">{approval.resolution_note}</span>
          </div>
        )}

        {/* Note input */}
        {isPending && !isExpired && showNoteInput && (
          <Textarea
            placeholder="Add a note (optional for approve, recommended for deny)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="text-sm resize-none"
          />
        )}
      </CardContent>

      {/* Actions */}
      {isPending && !isExpired && (
        <CardFooter className="flex justify-end gap-2 pt-0 pb-3">
          {!showNoteInput ? (
            <>
              {onViewDetails && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onViewDetails(approval)}
                  className="text-xs mr-auto"
                >
                  <Eye className="h-3.5 w-3.5 mr-1" />
                  Details
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowNoteInput(true)}
                className="text-xs"
                disabled={isActing}
              >
                Add Note
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleReject}
                disabled={isActing}
              >
                {rejectMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <X className="h-4 w-4 mr-1" />
                    Deny
                  </>
                )}
              </Button>
              <Button
                size="sm"
                onClick={handleApprove}
                disabled={isActing}
                className="bg-accent-green hover:bg-accent-green/90 text-white"
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
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowNoteInput(false)}
                className="text-xs"
                disabled={isActing}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleReject}
                disabled={isActing}
              >
                {rejectMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Deny with Note"
                )}
              </Button>
              <Button
                size="sm"
                onClick={handleApprove}
                disabled={isActing}
                className="bg-accent-green hover:bg-accent-green/90 text-white"
              >
                {approveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Approve with Note"
                )}
              </Button>
            </>
          )}
        </CardFooter>
      )}
    </Card>
  );
}
