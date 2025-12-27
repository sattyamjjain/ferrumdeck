"use client";

import { useState } from "react";
import Link from "next/link";
import { Shield, Clock, ExternalLink, Check, X, Loader2 } from "lucide-react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { JsonViewer } from "@/components/shared/json-viewer";
import { useApproveAction, useRejectAction } from "@/hooks/use-approvals";
import { formatTimeAgo, truncateId } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { ApprovalRequest } from "@/types/approval";

interface ApprovalCardProps {
  approval: ApprovalRequest;
}

export function ApprovalCard({ approval }: ApprovalCardProps) {
  const [note, setNote] = useState("");
  const [showNoteInput, setShowNoteInput] = useState(false);
  const approveMutation = useApproveAction();
  const rejectMutation = useRejectAction();

  const isPending = approval.status === "pending";
  const isExpired = approval.expires_at && new Date(approval.expires_at) < new Date();

  const handleApprove = () => {
    approveMutation.mutate({ approvalId: approval.id, note: note || undefined });
  };

  const handleReject = () => {
    rejectMutation.mutate({ approvalId: approval.id, note: note || undefined });
  };

  const isActing = approveMutation.isPending || rejectMutation.isPending;

  return (
    <Card className={cn(
      "border-l-4",
      isPending && !isExpired ? "border-l-purple-500" :
      approval.status === "approved" ? "border-l-green-500" :
      approval.status === "rejected" ? "border-l-red-500" :
      "border-l-muted"
    )}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-purple-400" />
            <span className="font-medium">{approval.tool_name || approval.action_type || "Action"}</span>
            <Badge
              variant="secondary"
              className={cn(
                "text-xs",
                isPending && !isExpired ? "bg-purple-500/20 text-purple-400" :
                approval.status === "approved" ? "bg-green-500/20 text-green-400" :
                approval.status === "rejected" ? "bg-red-500/20 text-red-400" :
                "bg-secondary"
              )}
            >
              {isExpired ? "Expired" : approval.status}
            </Badge>
          </div>
          <Link href={`/runs/${approval.run_id}`}>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
              View Run <ExternalLink className="h-3 w-3 ml-1" />
            </Button>
          </Link>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="font-mono">{truncateId(approval.id)}</span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatTimeAgo(approval.created_at)}
          </span>
          {approval.expires_at && (
            <span className={cn(isExpired && "text-red-400")}>
              Expires: {formatTimeAgo(approval.expires_at)}
            </span>
          )}
        </div>

        {approval.reason && (
          <div className="text-sm">
            <span className="text-muted-foreground">Reason: </span>
            {approval.reason}
          </div>
        )}

        {approval.action_details && Object.keys(approval.action_details).length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-1">Action Details</p>
            <JsonViewer data={approval.action_details} collapsed />
          </div>
        )}

        {approval.resolution_note && (
          <div className="text-sm">
            <span className="text-muted-foreground">Note: </span>
            {approval.resolution_note}
          </div>
        )}

        {isPending && !isExpired && showNoteInput && (
          <Textarea
            placeholder="Add a note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="text-sm"
          />
        )}
      </CardContent>

      {isPending && !isExpired && (
        <CardFooter className="flex justify-end gap-2 pt-0">
          {!showNoteInput ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowNoteInput(true)}
                className="text-xs"
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
                    Reject
                  </>
                )}
              </Button>
              <Button
                size="sm"
                onClick={handleApprove}
                disabled={isActing}
                className="bg-green-600 hover:bg-green-700"
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
                  "Reject with Note"
                )}
              </Button>
              <Button
                size="sm"
                onClick={handleApprove}
                disabled={isActing}
                className="bg-green-600 hover:bg-green-700"
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
