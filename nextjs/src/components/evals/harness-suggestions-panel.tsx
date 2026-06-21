"use client";

import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Lightbulb,
  XCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  useHarnessSuggestions,
  useResolveHarnessSuggestion,
} from "@/hooks/use-harness-suggestions";
import type {
  HarnessSuggestion,
  SuggestionStatus,
} from "@/types/harness-suggestion";

interface HarnessSuggestionsPanelProps {
  /** Agent the eval run targets. When absent (legacy/stub run), renders null. */
  agentId?: string;
}

const statusConfig: Record<
  SuggestionStatus,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  proposed: {
    label: "Proposed",
    className: "bg-accent-yellow/20 text-accent-yellow border-accent-yellow/30",
    icon: Clock,
  },
  approved: {
    label: "Approved",
    className: "bg-green-500/20 text-green-400 border-green-500/30",
    icon: CheckCircle2,
  },
  rejected: {
    label: "Rejected",
    className: "bg-red-500/20 text-red-400 border-red-500/30",
    icon: XCircle,
  },
};

/**
 * Harness suggestions panel (HarnessX trace->delta).
 *
 * Surfaces eval-derived, PROPOSED harness/policy deltas for human review.
 * Approving records the decision in the audit trail and never auto-applies a
 * change — deny-by-default + human-in-the-loop are preserved. Reads the
 * agent's audit-backed suggestions via TanStack Query; renders `null` when
 * there is no agent id or no suggestions so legacy/stub runs are unaffected.
 */
export function HarnessSuggestionsPanel({
  agentId,
}: HarnessSuggestionsPanelProps) {
  const { data, isLoading } = useHarnessSuggestions(agentId);
  const resolve = useResolveHarnessSuggestion(agentId);

  if (!agentId) {
    return null;
  }

  if (isLoading) {
    return (
      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-4 w-72 mt-2" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  const suggestions = data?.suggestions ?? [];
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <Card className="bg-card/50 border-border/50">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-background-secondary flex items-center justify-center shrink-0">
              <Lightbulb className="h-5 w-5 text-accent-yellow" />
            </div>
            <div>
              <CardTitle className="text-base">Harness suggestions</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Eval-derived, <strong>proposed</strong> harness/policy changes.
                Approving records the decision — it is{" "}
                <strong>not auto-applied</strong>; applying is a separate manual
                step.
              </CardDescription>
            </div>
          </div>
          {data?.anchor ? (
            <Badge
              variant="outline"
              className="border-accent-yellow/30 text-accent-yellow text-xs"
            >
              {data.anchor}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {suggestions.map((s) => (
          <SuggestionCard
            key={s.id}
            suggestion={s}
            disabled={resolve.isPending}
            onResolve={(approve) =>
              resolve.mutate({ suggestionId: s.id, approve })
            }
          />
        ))}
      </CardContent>
    </Card>
  );
}

function SuggestionCard({
  suggestion,
  disabled,
  onResolve,
}: {
  suggestion: HarnessSuggestion;
  disabled: boolean;
  onResolve: (approve: boolean) => void;
}) {
  const cfg = statusConfig[suggestion.status];
  const StatusIcon = cfg.icon;
  const pending = suggestion.status === "proposed";

  return (
    <div className="rounded-lg border border-border/50 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono text-xs">
            {suggestion.kind}
          </Badge>
          <Badge variant="outline" className={cn("text-xs gap-1", cfg.className)}>
            <StatusIcon className="h-3 w-3" />
            {cfg.label}
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          confidence {(suggestion.confidence * 100).toFixed(0)}%
        </span>
      </div>

      <p className="text-sm text-foreground">{suggestion.reason}</p>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-2">
        <JsonBlock label="current" value={suggestion.current} />
        <ArrowRight className="h-4 w-4 text-muted-foreground mx-auto hidden sm:block" />
        <JsonBlock label="proposed" value={suggestion.proposed} highlight />
      </div>

      {suggestion.evidence.length > 0 ? (
        <ul className="space-y-1">
          {suggestion.evidence.map((e, i) => (
            <li key={`${e.code}-${i}`} className="text-xs text-muted-foreground">
              <span className="font-mono text-foreground">{e.code}</span>:{" "}
              {e.detail}
              {e.observed != null ? (
                <span className="tabular-nums"> ({e.observed})</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          className="border-green-500/30 text-green-400 hover:bg-green-500/10"
          disabled={!pending || disabled}
          onClick={() => onResolve(true)}
        >
          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="border-red-500/30 text-red-400 hover:bg-red-500/10"
          disabled={!pending || disabled}
          onClick={() => onResolve(false)}
        >
          <XCircle className="h-3.5 w-3.5 mr-1" />
          Reject
        </Button>
        {!pending ? (
          <span className="text-xs text-muted-foreground">
            Resolved — recorded in the audit trail, not applied.
          </span>
        ) : null}
      </div>
    </div>
  );
}

function JsonBlock({
  label,
  value,
  highlight,
}: {
  label: string;
  value: unknown;
  highlight?: boolean;
}) {
  return (
    <div className="space-y-1 min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <pre
        className={cn(
          "text-xs rounded-md p-2 overflow-x-auto bg-background-secondary border",
          highlight ? "border-accent-yellow/30" : "border-border/50"
        )}
      >
        {safeStringify(value)}
      </pre>
    </div>
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
