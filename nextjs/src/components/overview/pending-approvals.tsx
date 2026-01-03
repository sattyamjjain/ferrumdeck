"use client";

import { useState } from "react";
import Link from "next/link";
import { Shield, Clock, Check, X, Loader2, ArrowRight, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useApproveAction, useRejectAction } from "@/hooks/use-approvals";
import { formatTimeAgo, truncateId, cn } from "@/lib/utils";
import type { ApprovalRequest } from "@/types/approval";

interface PendingApprovalsProps {
  approvals: ApprovalRequest[];
  isLoading?: boolean;
  limit?: number;
}

export function PendingApprovals({
  approvals,
  isLoading,
  limit = 5,
}: PendingApprovalsProps) {
  const pendingApprovals = approvals
    .filter((a) => a.status === "pending")
    .slice(0, limit);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-accent-purple/10">
            <Shield className="h-4 w-4 text-accent-purple" />
          </div>
          Pending Approvals
          {pendingApprovals.length > 0 && (
            <Badge
              variant="secondary"
              className="ml-2 h-5 min-w-5 px-1.5 bg-accent-purple/20 text-accent-purple border-accent-purple/30"
            >
              {pendingApprovals.length}
            </Badge>
          )}
        </CardTitle>
        <Button variant="ghost" size="sm" asChild className="text-xs">
          <Link href="/approvals" className="flex items-center gap-1">
            View All
            <ArrowRight className="h-3 w-3" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <PendingApprovalSkeleton key={i} />
            ))}
          </div>
        ) : pendingApprovals.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <Shield className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">No pending approvals</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              All actions are approved or rejected
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {pendingApprovals.map((approval, index) => (
              <PendingApprovalCard key={approval.id} approval={approval} index={index} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface PendingApprovalCardProps {
  approval: ApprovalRequest;
  index: number;
}

function PendingApprovalCard({ approval, index }: PendingApprovalCardProps) {
  const [isActing, setIsActing] = useState(false);
  const approveMutation = useApproveAction();
  const rejectMutation = useRejectAction();

  const handleApprove = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsActing(true);
    try {
      await approveMutation.mutateAsync({ approvalId: approval.id });
    } finally {
      setIsActing(false);
    }
  };

  const handleReject = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsActing(true);
    try {
      await rejectMutation.mutateAsync({ approvalId: approval.id });
    } finally {
      setIsActing(false);
    }
  };

  const isExpired = approval.expires_at && new Date(approval.expires_at) < new Date();
  const isProcessing = approveMutation.isPending || rejectMutation.isPending || isActing;

  return (
    <div
      className={cn(
        "group p-3 rounded-lg border border-l-4 border-l-accent-purple border-border/50 bg-card/30 opacity-0 animate-fade-in",
        index <= 5 && `stagger-${Math.min(index + 1, 8)}`
      )}
      style={{ animationFillMode: "forwards" }}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Tool info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm truncate">
              {approval.tool_name || approval.action_type || "Action"}
            </span>
            {isExpired && (
              <Badge variant="secondary" className="text-[10px] bg-accent-red/10 text-accent-red">
                Expired
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="font-mono">{truncateId(approval.id, 8)}</span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatTimeAgo(approval.created_at)}
            </span>
          </div>
          {approval.reason && (
            <p className="text-xs text-muted-foreground/70 mt-1 truncate">
              {approval.reason}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Link href={`/runs/${approval.run_id}`} onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="View Run"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </Link>
          {!isExpired && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:bg-accent-red/10 hover:text-accent-red"
                onClick={handleReject}
                disabled={isProcessing}
                title="Reject"
              >
                {rejectMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <X className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:bg-accent-green/10 hover:text-accent-green"
                onClick={handleApprove}
                disabled={isProcessing}
                title="Approve"
              >
                {approveMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PendingApprovalSkeleton() {
  return (
    <div className="p-3 rounded-lg border border-l-4 border-l-accent-purple/30 border-border/30 bg-card/20">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-7 w-7 rounded" />
          <Skeleton className="h-7 w-7 rounded" />
          <Skeleton className="h-7 w-7 rounded" />
        </div>
      </div>
    </div>
  );
}
