"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Wrench,
  MoreHorizontal,
  ExternalLink,
  Trash2,
  Settings,
  Clock,
  Users,
  AlertCircle,
  CheckCircle,
  XCircle,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { cn, formatTimeAgo } from "@/lib/utils";
import { useDeleteTool } from "@/hooks/use-tools";
import type { Tool, ToolRiskLevel, ToolHealthStatus, ToolStatus } from "@/types/tool";
import { SkeletonTableRow } from "@/components/shared/loading-spinner";
import { EmptyRow } from "@/components/shared/empty-state";

// Risk level configuration
const riskConfig: Record<ToolRiskLevel, { label: string; className: string }> = {
  low: {
    label: "LOW",
    className: "bg-accent-green/15 text-accent-green border-accent-green/30",
  },
  medium: {
    label: "MEDIUM",
    className: "bg-accent-yellow/15 text-accent-yellow border-accent-yellow/30",
  },
  high: {
    label: "HIGH",
    className: "bg-accent-orange/15 text-accent-orange border-accent-orange/30",
  },
  critical: {
    label: "CRITICAL",
    className: "bg-accent-red/15 text-accent-red border-accent-red/30",
  },
};

// Health status configuration
const healthConfig: Record<ToolHealthStatus, { label: string; icon: typeof CheckCircle; className: string }> = {
  ok: {
    label: "OK",
    icon: CheckCircle,
    className: "text-accent-green",
  },
  slow: {
    label: "SLOW",
    icon: Clock,
    className: "text-accent-yellow",
  },
  error: {
    label: "ERROR",
    icon: XCircle,
    className: "text-accent-red",
  },
  unknown: {
    label: "Unknown",
    icon: AlertCircle,
    className: "text-muted-foreground",
  },
};

// Status configuration - reserved for future use
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const statusConfig: Record<ToolStatus, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-accent-green/15 text-accent-green" },
  deprecated: { label: "Deprecated", className: "bg-accent-yellow/15 text-accent-yellow" },
  disabled: { label: "Disabled", className: "bg-secondary text-secondary-foreground" },
};

interface ToolTableProps {
  tools: Tool[];
  isLoading?: boolean;
}

export function ToolTable({ tools, isLoading }: ToolTableProps) {
  const [deleteToolId, setDeleteToolId] = useState<string | null>(null);
  const deleteMutation = useDeleteTool();

  const handleDelete = async () => {
    if (!deleteToolId) return;
    await deleteMutation.mutateAsync(deleteToolId);
    setDeleteToolId(null);
  };

  return (
    <>
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[280px]">Tool</TableHead>
              <TableHead className="w-[100px]">Risk Level</TableHead>
              <TableHead className="w-[150px]">MCP Server</TableHead>
              <TableHead className="w-[100px]">Status</TableHead>
              <TableHead className="w-[100px]">Version</TableHead>
              <TableHead className="w-[100px]">Used By</TableHead>
              <TableHead className="w-[140px]">Last Called</TableHead>
              <TableHead className="w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <>
                <SkeletonTableRow columns={8} />
                <SkeletonTableRow columns={8} />
                <SkeletonTableRow columns={8} />
                <SkeletonTableRow columns={8} />
                <SkeletonTableRow columns={8} />
              </>
            ) : tools.length === 0 ? (
              <EmptyRow colSpan={8} message="No tools found" />
            ) : (
              tools.map((tool) => (
                <ToolTableRow
                  key={tool.id}
                  tool={tool}
                  onDelete={() => setDeleteToolId(tool.id)}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteToolId} onOpenChange={() => setDeleteToolId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Tool</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this tool? This action cannot be undone.
              All agents using this tool will need to be updated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface ToolTableRowProps {
  tool: Tool;
  onDelete: () => void;
}

function ToolTableRow({ tool, onDelete }: ToolTableRowProps) {
  const risk = riskConfig[tool.risk_level] || riskConfig.low;
  const health = healthConfig[tool.health_status] || healthConfig.unknown;
  const HealthIcon = health.icon;

  return (
    <TableRow className="group">
      {/* Tool Name */}
      <TableCell>
        <Link
          href={`/tools/${tool.id}`}
          className="flex items-center gap-3 hover:text-accent-blue transition-colors"
        >
          <div className="p-2 rounded-lg bg-accent-cyan/10 border border-accent-cyan/20">
            <Wrench className="h-4 w-4 text-accent-cyan" />
          </div>
          <div className="min-w-0">
            <p className="font-medium truncate">{tool.name}</p>
            <p className="text-xs text-muted-foreground font-mono truncate">{tool.slug}</p>
          </div>
        </Link>
      </TableCell>

      {/* Risk Level */}
      <TableCell>
        <Badge variant="outline" className={cn("text-xs font-medium border", risk.className)}>
          {risk.label}
        </Badge>
      </TableCell>

      {/* MCP Server */}
      <TableCell>
        <span className="text-sm font-mono text-muted-foreground">{tool.mcp_server}</span>
      </TableCell>

      {/* Health Status */}
      <TableCell>
        <div className="flex items-center gap-1.5">
          <HealthIcon className={cn("h-4 w-4", health.className)} />
          <span className={cn("text-sm", health.className)}>{health.label}</span>
        </div>
      </TableCell>

      {/* Schema Version */}
      <TableCell>
        <span className="text-sm text-muted-foreground font-mono">
          {tool.schema_version || "-"}
        </span>
      </TableCell>

      {/* Used By */}
      <TableCell>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          <span>{tool.used_by_count} agents</span>
        </div>
      </TableCell>

      {/* Last Called */}
      <TableCell>
        <span className="text-sm text-muted-foreground">
          {tool.last_called ? formatTimeAgo(tool.last_called) : "Never"}
        </span>
      </TableCell>

      {/* Actions */}
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/tools/${tool.id}`}>
                <ExternalLink className="h-4 w-4 mr-2" />
                View Details
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/tools/${tool.id}?tab=policy`}>
                <Settings className="h-4 w-4 mr-2" />
                Configure Policy
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Tool
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}
