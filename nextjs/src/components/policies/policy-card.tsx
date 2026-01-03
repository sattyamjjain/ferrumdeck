"use client";

import { useState } from "react";
import {
  Shield,
  ChevronDown,
  ChevronRight,
  Clock,
  MoreVertical,
  Copy,
  Pencil,
  Trash2,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatTimeAgo, cn } from "@/lib/utils";
import type { Policy, PolicyRule, PolicyStatus, PolicyAction } from "@/types/policy";

const statusConfig: Record<PolicyStatus, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-green-500/20 text-green-400 border-green-500/30" },
  inactive: { label: "Inactive", className: "bg-secondary text-secondary-foreground border-border" },
  draft: { label: "Draft", className: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
};

const actionConfig: Record<PolicyAction, { label: string; className: string; icon: typeof CheckCircle }> = {
  allow: { label: "ALLOW", className: "bg-green-500/20 text-green-400", icon: CheckCircle },
  deny: { label: "DENY", className: "bg-red-500/20 text-red-400", icon: XCircle },
  require_approval: { label: "REQUIRE APPROVAL", className: "bg-yellow-500/20 text-yellow-400", icon: AlertTriangle },
};

interface PolicyRuleItemProps {
  rule: PolicyRule;
  index: number;
}

function PolicyRuleItem({ rule, index }: PolicyRuleItemProps) {
  const action = actionConfig[rule.action] || actionConfig.deny;
  const ActionIcon = action.icon;

  return (
    <div className="flex items-start gap-3 py-2 px-3 rounded-md bg-muted/30 border border-border/50">
      <span className="text-xs text-muted-foreground font-mono mt-0.5">
        {String(index + 1).padStart(2, "0")}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <Badge variant="secondary" className={cn("text-xs font-mono", action.className)}>
            <ActionIcon className="h-3 w-3 mr-1" />
            {action.label}
          </Badge>
        </div>
        <p className="text-sm font-mono text-muted-foreground break-all">
          {rule.condition}
        </p>
        {rule.description && (
          <p className="text-xs text-muted-foreground/70 mt-1">
            {rule.description}
          </p>
        )}
      </div>
    </div>
  );
}

interface PolicyCardProps {
  policy: Policy;
  onEdit?: (policy: Policy) => void;
  onDuplicate?: (policy: Policy) => void;
  onDelete?: (policy: Policy) => void;
  isAdmin?: boolean;
}

export function PolicyCard({
  policy,
  onEdit,
  onDuplicate,
  onDelete,
  isAdmin = false,
}: PolicyCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const status = statusConfig[policy.status] || statusConfig.inactive;

  return (
    <Card className="hover:bg-card/80 transition-colors">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="p-2 rounded-lg bg-purple-500/10 shrink-0">
              <Shield className="h-4 w-4 text-purple-400" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base truncate">{policy.name}</CardTitle>
              <p className="text-xs text-muted-foreground font-mono">{policy.slug}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="outline" className="text-xs">
              Priority: {policy.priority}
            </Badge>
            <Badge variant="secondary" className={cn("text-xs border", status.className)}>
              {status.label}
            </Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreVertical className="h-4 w-4" />
                  <span className="sr-only">Actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onEdit?.(policy)}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onDuplicate?.(policy)}>
                  <Copy className="h-4 w-4 mr-2" />
                  Duplicate
                </DropdownMenuItem>
                {isAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => onDelete?.(policy)}
                      className="text-red-400 focus:text-red-400"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {policy.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {policy.description}
          </p>
        )}

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatTimeAgo(policy.created_at)}
          </span>
          <span>
            {policy.rules.length} rule{policy.rules.length !== 1 ? "s" : ""}
          </span>
          {policy.agent_ids && policy.agent_ids.length > 0 && (
            <Badge variant="outline" className="text-xs">
              {policy.agent_ids.length} agent{policy.agent_ids.length !== 1 ? "s" : ""}
            </Badge>
          )}
          {policy.tool_ids && policy.tool_ids.length > 0 && (
            <Badge variant="outline" className="text-xs">
              {policy.tool_ids.length} tool{policy.tool_ids.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>

        {/* Collapsible rules section */}
        <div className="pt-2 border-t border-border/50">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <span>Rules ({policy.rules.length})</span>
          </button>

          {isExpanded && policy.rules.length > 0 && (
            <div className="mt-3 space-y-2">
              {policy.rules
                .sort((a, b) => a.order - b.order)
                .map((rule, index) => (
                  <PolicyRuleItem key={rule.id} rule={rule} index={index} />
                ))}
            </div>
          )}

          {isExpanded && policy.rules.length === 0 && (
            <p className="mt-3 text-sm text-muted-foreground italic">
              No rules defined
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
