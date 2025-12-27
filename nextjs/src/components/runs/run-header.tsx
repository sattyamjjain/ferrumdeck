"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, XCircle, Loader2, Clock, DollarSign, Zap, Hash } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RunStatusBadge } from "./run-status-badge";
import { formatTimeAgo, formatCost, formatTokens, truncateId } from "@/lib/utils";
import { cancelRun } from "@/lib/api/runs";
import { toast } from "sonner";
import type { Run } from "@/types/run";

interface RunHeaderProps {
  run: Run;
}

export function RunHeader({ run }: RunHeaderProps) {
  const queryClient = useQueryClient();

  const cancelMutation = useMutation({
    mutationFn: () => cancelRun(run.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["run", run.id] });
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      toast.success("Run cancelled");
    },
    onError: () => {
      toast.error("Failed to cancel run");
    },
  });

  const canCancel = ["created", "queued", "running", "waiting_approval"].includes(run.status);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Link href="/runs">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold font-mono">{truncateId(run.id)}</h1>
            <RunStatusBadge status={run.status} />
          </div>
          {run.agent_id && (
            <p className="text-sm text-muted-foreground">
              Agent: <span className="font-mono">{truncateId(run.agent_id, 8)}</span>
            </p>
          )}
        </div>
        {canCancel && (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => cancelMutation.mutate()}
            disabled={cancelMutation.isPending}
          >
            {cancelMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <XCircle className="h-4 w-4 mr-1" />
            )}
            Cancel Run
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={Clock}
          label="Created"
          value={formatTimeAgo(run.created_at)}
        />
        <StatCard
          icon={DollarSign}
          label="Cost"
          value={formatCost(run.cost_cents)}
        />
        <StatCard
          icon={Zap}
          label="Tokens"
          value={formatTokens((run.input_tokens || 0) + (run.output_tokens || 0))}
        />
        <StatCard
          icon={Hash}
          label="Tool Calls"
          value={String(run.tool_calls || 0)}
        />
      </div>
    </div>
  );
}

interface StatCardProps {
  icon: typeof Clock;
  label: string;
  value: string;
}

function StatCard({ icon: Icon, label, value }: StatCardProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          <Icon className="h-4 w-4" />
          <span className="text-xs">{label}</span>
        </div>
        <p className="text-lg font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
