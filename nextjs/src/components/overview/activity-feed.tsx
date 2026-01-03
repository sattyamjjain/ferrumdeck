"use client";

import Link from "next/link";
import {
  Activity,
  Play,
  CheckCircle2,
  XCircle,
  Shield,
  AlertTriangle,
  Clock,
  ArrowRight,
  LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTimeAgo, truncateId, cn } from "@/lib/utils";
import type { Run } from "@/types/run";
import type { ApprovalRequest } from "@/types/approval";

interface ActivityFeedProps {
  runs: Run[];
  approvals: ApprovalRequest[];
  isLoading?: boolean;
  limit?: number;
}

type ActivityType =
  | "run_started"
  | "run_completed"
  | "run_failed"
  | "approval_pending"
  | "approval_granted"
  | "approval_rejected";

interface ActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  description: string;
  timestamp: string;
  href: string;
  icon: LucideIcon;
  iconColor: string;
  iconBgColor: string;
}

function getActivityConfig(type: ActivityType): {
  icon: LucideIcon;
  iconColor: string;
  iconBgColor: string;
} {
  switch (type) {
    case "run_started":
      return {
        icon: Play,
        iconColor: "text-accent-yellow",
        iconBgColor: "bg-accent-yellow/10",
      };
    case "run_completed":
      return {
        icon: CheckCircle2,
        iconColor: "text-accent-green",
        iconBgColor: "bg-accent-green/10",
      };
    case "run_failed":
      return {
        icon: XCircle,
        iconColor: "text-accent-red",
        iconBgColor: "bg-accent-red/10",
      };
    case "approval_pending":
      return {
        icon: Shield,
        iconColor: "text-accent-purple",
        iconBgColor: "bg-accent-purple/10",
      };
    case "approval_granted":
      return {
        icon: CheckCircle2,
        iconColor: "text-accent-green",
        iconBgColor: "bg-accent-green/10",
      };
    case "approval_rejected":
      return {
        icon: AlertTriangle,
        iconColor: "text-accent-red",
        iconBgColor: "bg-accent-red/10",
      };
  }
}

function buildActivityItems(
  runs: Run[],
  approvals: ApprovalRequest[],
  limit: number
): ActivityItem[] {
  const activities: ActivityItem[] = [];

  // Add run activities
  runs.forEach((run) => {
    // Run started
    if (run.started_at) {
      const config = getActivityConfig("run_started");
      activities.push({
        id: `${run.id}-started`,
        type: "run_started",
        title: "Run Started",
        description: `Run ${truncateId(run.id, 8)} started execution`,
        timestamp: run.started_at,
        href: `/runs/${run.id}`,
        ...config,
      });
    }

    // Run completed
    if (run.status === "completed" && run.completed_at) {
      const config = getActivityConfig("run_completed");
      activities.push({
        id: `${run.id}-completed`,
        type: "run_completed",
        title: "Run Completed",
        description: `Run ${truncateId(run.id, 8)} completed successfully`,
        timestamp: run.completed_at,
        href: `/runs/${run.id}`,
        ...config,
      });
    }

    // Run failed
    if (
      (run.status === "failed" ||
        run.status === "timeout" ||
        run.status === "budget_killed") &&
      run.completed_at
    ) {
      const config = getActivityConfig("run_failed");
      activities.push({
        id: `${run.id}-failed`,
        type: "run_failed",
        title: "Run Failed",
        description: `Run ${truncateId(run.id, 8)} failed: ${run.status_reason || run.status}`,
        timestamp: run.completed_at,
        href: `/runs/${run.id}`,
        ...config,
      });
    }
  });

  // Add approval activities
  approvals.forEach((approval) => {
    // Pending approval
    if (approval.status === "pending") {
      const config = getActivityConfig("approval_pending");
      activities.push({
        id: `${approval.id}-pending`,
        type: "approval_pending",
        title: "Approval Required",
        description: `${approval.tool_name || approval.action_type || "Action"} requires approval`,
        timestamp: approval.created_at,
        href: `/runs/${approval.run_id}`,
        ...config,
      });
    }

    // Approved
    if (approval.status === "approved" && approval.resolved_at) {
      const config = getActivityConfig("approval_granted");
      activities.push({
        id: `${approval.id}-approved`,
        type: "approval_granted",
        title: "Approval Granted",
        description: `${approval.tool_name || approval.action_type || "Action"} was approved`,
        timestamp: approval.resolved_at,
        href: `/runs/${approval.run_id}`,
        ...config,
      });
    }

    // Rejected
    if (approval.status === "rejected" && approval.resolved_at) {
      const config = getActivityConfig("approval_rejected");
      activities.push({
        id: `${approval.id}-rejected`,
        type: "approval_rejected",
        title: "Approval Rejected",
        description: `${approval.tool_name || approval.action_type || "Action"} was rejected`,
        timestamp: approval.resolved_at,
        href: `/runs/${approval.run_id}`,
        ...config,
      });
    }
  });

  // Sort by timestamp (most recent first) and limit
  return activities
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}

export function ActivityFeed({
  runs,
  approvals,
  isLoading,
  limit = 15,
}: ActivityFeedProps) {
  const activities = buildActivityItems(runs, approvals, limit);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-accent-cyan/10">
            <Activity className="h-4 w-4 text-accent-cyan" />
          </div>
          Activity Feed
        </CardTitle>
        <Button variant="ghost" size="sm" asChild className="text-xs">
          <Link href="/audit" className="flex items-center gap-1">
            View Audit Log
            <ArrowRight className="h-3 w-3" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0">
        {isLoading ? (
          <div className="space-y-0 px-6 pb-6">
            {[1, 2, 3, 4, 5].map((i) => (
              <ActivityItemSkeleton key={i} />
            ))}
          </div>
        ) : activities.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <Activity className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">No recent activity</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Activity will appear here as runs execute
            </p>
          </div>
        ) : (
          <ScrollArea className="h-[280px] px-6 pb-6">
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border" />

              {/* Activity items */}
              <div className="space-y-0">
                {activities.map((activity, index) => (
                  <ActivityItemComponent
                    key={activity.id}
                    activity={activity}
                    index={index}
                  />
                ))}
              </div>
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

interface ActivityItemComponentProps {
  activity: ActivityItem;
  index: number;
}

function ActivityItemComponent({ activity, index }: ActivityItemComponentProps) {
  const Icon = activity.icon;

  return (
    <Link
      href={activity.href}
      className={cn(
        "group relative flex gap-3 py-3 opacity-0 animate-fade-in",
        index <= 10 && `stagger-${Math.min(index + 1, 8)}`
      )}
      style={{ animationFillMode: "forwards" }}
    >
      {/* Icon */}
      <div
        className={cn(
          "relative z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background",
          activity.iconBgColor
        )}
      >
        <Icon className={cn("h-3 w-3", activity.iconColor)} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pr-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm group-hover:text-primary transition-colors">
            {activity.title}
          </span>
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatTimeAgo(activity.timestamp)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground/70 truncate mt-0.5">
          {activity.description}
        </p>
      </div>
    </Link>
  );
}

function ActivityItemSkeleton() {
  return (
    <div className="relative flex gap-3 py-3">
      <Skeleton className="h-6 w-6 rounded-full flex-shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="h-3 w-full" />
      </div>
    </div>
  );
}
