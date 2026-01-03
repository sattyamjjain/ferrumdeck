"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Layers,
  Rocket,
  GitCompare,
  Calendar,
  User,
  FileText,
  Plus,
  ChevronDown,
  ChevronRight,
  CheckCircle,
} from "lucide-react";
import { cn, formatDateTime, formatTimeAgo } from "@/lib/utils";
import { EmptyState } from "@/components/shared/empty-state";
import type { AgentVersion, DeploymentEnvironment } from "@/types/agent";

interface AgentVersionsProps {
  versions: AgentVersion[];
  onPromote: (version: AgentVersion) => void;
}

const environmentColors: Record<DeploymentEnvironment, { bg: string; text: string; border: string }> = {
  development: {
    bg: "bg-accent-blue/10",
    text: "text-accent-blue",
    border: "border-accent-blue/30",
  },
  staging: {
    bg: "bg-accent-yellow/10",
    text: "text-accent-yellow",
    border: "border-accent-yellow/30",
  },
  production: {
    bg: "bg-accent-green/10",
    text: "text-accent-green",
    border: "border-accent-green/30",
  },
};

function VersionDiffDialog({
  open,
  onOpenChange,
  version1,
  version2,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  version1: AgentVersion | null;
  version2: AgentVersion | null;
}) {
  if (!version1 || !version2) return null;

  // Calculate differences
  const toolsDiff = {
    added: version2.allowed_tools?.filter((t) => !version1.allowed_tools?.includes(t)) || [],
    removed: version1.allowed_tools?.filter((t) => !version2.allowed_tools?.includes(t)) || [],
  };

  const approvalDiff = {
    added: version2.approval_tools?.filter((t) => !version1.approval_tools?.includes(t)) || [],
    removed: version1.approval_tools?.filter((t) => !version2.approval_tools?.includes(t)) || [],
  };

  const modelChanged = version1.model !== version2.model;
  const promptChanged = version1.system_prompt !== version2.system_prompt;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompare className="h-5 w-5 text-accent-purple" />
            Version Comparison
          </DialogTitle>
          <DialogDescription>
            Comparing v{version1.version} to v{version2.version}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-6 pr-4">
            {/* Model changes */}
            {modelChanged && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-accent-yellow" />
                  Model Changed
                </h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="p-3 rounded-lg bg-accent-red/10 border border-accent-red/30">
                    <p className="text-xs text-muted-foreground mb-1">From</p>
                    <code className="text-accent-red">{version1.model}</code>
                  </div>
                  <div className="p-3 rounded-lg bg-accent-green/10 border border-accent-green/30">
                    <p className="text-xs text-muted-foreground mb-1">To</p>
                    <code className="text-accent-green">{version2.model}</code>
                  </div>
                </div>
              </div>
            )}

            {/* Prompt changes */}
            {promptChanged && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-accent-yellow" />
                  System Prompt Changed
                </h4>
                <p className="text-xs text-muted-foreground">
                  The system prompt has been modified. View the full versions for details.
                </p>
              </div>
            )}

            {/* Tool changes */}
            {(toolsDiff.added.length > 0 || toolsDiff.removed.length > 0) && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-accent-purple" />
                  Allowed Tools
                </h4>
                <div className="space-y-2">
                  {toolsDiff.added.map((tool) => (
                    <div
                      key={tool}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent-green/10 border border-accent-green/30"
                    >
                      <Plus className="h-3 w-3 text-accent-green" />
                      <code className="text-sm text-accent-green">{tool}</code>
                    </div>
                  ))}
                  {toolsDiff.removed.map((tool) => (
                    <div
                      key={tool}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent-red/10 border border-accent-red/30"
                    >
                      <span className="h-3 w-0.5 bg-accent-red" />
                      <code className="text-sm text-accent-red line-through">{tool}</code>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Approval tool changes */}
            {(approvalDiff.added.length > 0 || approvalDiff.removed.length > 0) && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-accent-yellow" />
                  Approval Tools
                </h4>
                <div className="space-y-2">
                  {approvalDiff.added.map((tool) => (
                    <div
                      key={tool}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent-green/10 border border-accent-green/30"
                    >
                      <Plus className="h-3 w-3 text-accent-green" />
                      <code className="text-sm text-accent-green">{tool}</code>
                    </div>
                  ))}
                  {approvalDiff.removed.map((tool) => (
                    <div
                      key={tool}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent-red/10 border border-accent-red/30"
                    >
                      <span className="h-3 w-0.5 bg-accent-red" />
                      <code className="text-sm text-accent-red line-through">{tool}</code>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* No changes */}
            {!modelChanged &&
              !promptChanged &&
              toolsDiff.added.length === 0 &&
              toolsDiff.removed.length === 0 &&
              approvalDiff.added.length === 0 &&
              approvalDiff.removed.length === 0 && (
                <div className="py-8 text-center">
                  <CheckCircle className="h-8 w-8 text-accent-green mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    No significant differences detected
                  </p>
                </div>
              )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export function AgentVersions({ versions, onPromote }: AgentVersionsProps) {
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());
  const [diffDialogOpen, setDiffDialogOpen] = useState(false);
  const [diffVersions, setDiffVersions] = useState<{
    version1: AgentVersion | null;
    version2: AgentVersion | null;
  }>({ version1: null, version2: null });

  const toggleExpanded = (versionId: string) => {
    const newExpanded = new Set(expandedVersions);
    if (newExpanded.has(versionId)) {
      newExpanded.delete(versionId);
    } else {
      newExpanded.add(versionId);
    }
    setExpandedVersions(newExpanded);
  };

  const handleViewDiff = (version: AgentVersion, previousVersion: AgentVersion) => {
    setDiffVersions({ version1: previousVersion, version2: version });
    setDiffDialogOpen(true);
  };

  if (!versions || versions.length === 0) {
    return (
      <Card className="bg-card/50 border-border/50">
        <CardContent className="py-12">
          <EmptyState
            icon={Layers}
            title="No Versions"
            description="This agent has no versions yet. Create a version to start using this agent."
            variant="compact"
          />
        </CardContent>
      </Card>
    );
  }

  // Sort versions by created_at descending
  const sortedVersions = [...versions].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <>
      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-background-secondary flex items-center justify-center">
                <Layers className="h-5 w-5 text-accent-purple" />
              </div>
              <div>
                <CardTitle className="text-base">Version History</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  {versions.length} version{versions.length !== 1 ? "s" : ""} available
                </CardDescription>
              </div>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              <Plus className="h-3 w-3" />
              New Version
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {sortedVersions.map((version, index) => {
              const isExpanded = expandedVersions.has(version.id);
              const previousVersion = sortedVersions[index + 1];
              const isLatest = index === 0;

              return (
                <div
                  key={version.id}
                  className={cn(
                    "rounded-lg border transition-colors",
                    isExpanded
                      ? "border-border bg-background-secondary/50"
                      : "border-border/30 hover:border-border/50"
                  )}
                >
                  {/* Version header */}
                  <div
                    className="flex items-center justify-between p-4 cursor-pointer"
                    onClick={() => toggleExpanded(version.id)}
                  >
                    <div className="flex items-center gap-3">
                      <button className="p-1 rounded hover:bg-background-tertiary transition-colors">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>

                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium">v{version.version}</span>
                        {isLatest && (
                          <Badge
                            variant="outline"
                            className="text-xs bg-accent-green/10 text-accent-green border-accent-green/30"
                          >
                            Latest
                          </Badge>
                        )}
                        {version.deployed_environments?.map((env) => (
                          <Badge
                            key={env}
                            variant="outline"
                            className={cn(
                              "text-xs capitalize",
                              environmentColors[env].bg,
                              environmentColors[env].text,
                              environmentColors[env].border
                            )}
                          >
                            {env}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatTimeAgo(version.created_at)}
                        </span>
                        {version.created_by && (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {version.created_by}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1.5 text-xs h-7"
                          onClick={() => onPromote(version)}
                        >
                          <Rocket className="h-3 w-3" />
                          Promote
                        </Button>
                        {previousVersion && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1.5 text-xs h-7"
                            onClick={() => handleViewDiff(version, previousVersion)}
                          >
                            <GitCompare className="h-3 w-3" />
                            Diff
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-0 border-t border-border/30 mt-0 space-y-4">
                      {/* Changelog */}
                      {version.changelog && (
                        <div className="pt-4">
                          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <FileText className="h-3 w-3" />
                            Changelog
                          </h4>
                          <p className="text-sm text-foreground whitespace-pre-wrap">
                            {version.changelog}
                          </p>
                        </div>
                      )}

                      {/* Version details */}
                      <div className="pt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                            Model
                          </p>
                          <Badge variant="outline" className="font-mono text-xs">
                            {version.model}
                          </Badge>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                            Allowed Tools
                          </p>
                          <p className="text-sm">{version.allowed_tools?.length || 0}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                            Approval Tools
                          </p>
                          <p className="text-sm">{version.approval_tools?.length || 0}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                            Created
                          </p>
                          <p className="text-sm">{formatDateTime(version.created_at)}</p>
                        </div>
                      </div>

                      {/* Tools list */}
                      {(version.allowed_tools?.length || 0) > 0 && (
                        <div className="pt-4">
                          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
                            Tools
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {version.allowed_tools?.map((tool) => (
                              <Badge
                                key={tool}
                                variant="secondary"
                                className="text-xs bg-background-tertiary"
                              >
                                {tool}
                              </Badge>
                            ))}
                            {version.approval_tools?.map((tool) => (
                              <Badge
                                key={tool}
                                variant="secondary"
                                className="text-xs bg-accent-yellow/10 text-accent-yellow border-accent-yellow/30"
                              >
                                {tool} (approval)
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <VersionDiffDialog
        open={diffDialogOpen}
        onOpenChange={setDiffDialogOpen}
        version1={diffVersions.version1}
        version2={diffVersions.version2}
      />
    </>
  );
}
