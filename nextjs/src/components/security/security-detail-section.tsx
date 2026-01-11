"use client";

import { cn } from "@/lib/utils";
import type { RiskLevel } from "@/types";
import type { Threat, ViolationType } from "@/types/security";
import { getViolationTypeLabel } from "@/types/security";
import { SecurityBadge, ViolationBadge, RiskScoreDisplay } from "./security-badge";
import { BlockedContentViewer } from "./blocked-content-viewer";
import { ShieldAlert, Clock, FileWarning, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface SecurityDetailSectionProps {
  threat?: Threat;
  // Alternative: pass individual fields for step output with airlock_violation
  violation?: {
    risk_score: number;
    risk_level: RiskLevel;
    violation_type: ViolationType;
    violation_details?: string;
  };
  blockedPayload?: Record<string, unknown>;
  className?: string;
}

export function SecurityDetailSection({
  threat,
  violation,
  blockedPayload,
  className,
}: SecurityDetailSectionProps) {
  // Use threat data if available, otherwise use violation
  const data = threat
    ? {
        risk_score: threat.risk_score,
        risk_level: threat.risk_level,
        violation_type: threat.violation_type,
        violation_details: threat.violation_details,
        blocked_payload: threat.blocked_payload,
        action: threat.action,
        shadow_mode: threat.shadow_mode,
        created_at: threat.created_at,
        tool_name: threat.tool_name,
      }
    : violation
    ? {
        risk_score: violation.risk_score,
        risk_level: violation.risk_level,
        violation_type: violation.violation_type,
        violation_details: violation.violation_details,
        blocked_payload: blockedPayload,
      }
    : null;

  if (!data) {
    return (
      <div className={cn("p-4 text-center text-foreground-muted", className)}>
        <ShieldAlert className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No security violations detected</p>
      </div>
    );
  }

  const isHighRisk = data.risk_level === "critical" || data.risk_level === "high";

  return (
    <div className={cn("space-y-4", className)}>
      {/* Header with risk level */}
      <div
        className={cn(
          "p-4 rounded-lg border",
          isHighRisk
            ? "bg-red-500/5 border-red-500/20"
            : "bg-yellow-500/5 border-yellow-500/20"
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "p-2 rounded-lg",
                isHighRisk ? "bg-red-500/10" : "bg-yellow-500/10"
              )}
            >
              <ShieldAlert
                className={cn(
                  "h-5 w-5",
                  isHighRisk ? "text-red-500" : "text-yellow-500"
                )}
              />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">
                Security Violation Detected
              </h3>
              <p className="text-sm text-foreground-muted mt-0.5">
                {getViolationTypeLabel(data.violation_type)}
              </p>
            </div>
          </div>
          <RiskScoreDisplay
            score={data.risk_score}
            riskLevel={data.risk_level}
          />
        </div>
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <p className="text-xs text-foreground-muted uppercase tracking-wider">
            Risk Level
          </p>
          <SecurityBadge riskLevel={data.risk_level} size="lg" />
        </div>

        <div className="space-y-1">
          <p className="text-xs text-foreground-muted uppercase tracking-wider">
            Violation Type
          </p>
          <ViolationBadge violationType={data.violation_type} size="lg" />
        </div>

        {data.tool_name && (
          <div className="space-y-1">
            <p className="text-xs text-foreground-muted uppercase tracking-wider">
              Tool
            </p>
            <p className="text-sm font-mono text-foreground">{data.tool_name}</p>
          </div>
        )}

        {data.action && (
          <div className="space-y-1">
            <p className="text-xs text-foreground-muted uppercase tracking-wider">
              Action Taken
            </p>
            <div className="flex items-center gap-2">
              {data.action === "blocked" ? (
                <>
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                  <span className="text-sm font-medium text-red-500">Blocked</span>
                </>
              ) : (
                <>
                  <FileWarning className="h-4 w-4 text-yellow-500" />
                  <span className="text-sm font-medium text-yellow-500">
                    Logged {data.shadow_mode && "(Shadow Mode)"}
                  </span>
                </>
              )}
            </div>
          </div>
        )}

        {data.created_at && (
          <div className="space-y-1">
            <p className="text-xs text-foreground-muted uppercase tracking-wider">
              Detected
            </p>
            <div className="flex items-center gap-2 text-sm text-foreground-muted">
              <Clock className="h-3.5 w-3.5" />
              <span>{formatDistanceToNow(new Date(data.created_at), { addSuffix: true })}</span>
            </div>
          </div>
        )}
      </div>

      {/* Violation details */}
      {data.violation_details && (
        <div className="space-y-2">
          <p className="text-xs text-foreground-muted uppercase tracking-wider">
            Details
          </p>
          <div className="p-3 rounded-lg bg-secondary/50 border border-border/50">
            <p className="text-sm text-foreground whitespace-pre-wrap">
              {data.violation_details}
            </p>
          </div>
        </div>
      )}

      {/* Blocked payload */}
      {data.blocked_payload && (
        <BlockedContentViewer
          content={data.blocked_payload}
          title="Blocked Payload"
        />
      )}
    </div>
  );
}
