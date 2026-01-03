"use client";

import { useState } from "react";
import {
  FileJson,
  Clock,
  User,
  Eye,
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  Tag,
} from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { JsonViewer } from "@/components/shared/json-viewer";
import { LoadingPage, SkeletonTableRow } from "@/components/shared/loading-spinner";
import { EmptyRow } from "@/components/shared/empty-state";
import { useToolVersions } from "@/hooks/use-tools";
import { cn, formatTimeAgo, formatDateTime } from "@/lib/utils";
import type { ToolVersion } from "@/types/tool";

interface ToolVersionsTabProps {
  toolId: string;
}

export function ToolVersionsTab({ toolId }: ToolVersionsTabProps) {
  const { data: versions, isLoading } = useToolVersions(toolId);
  const [selectedVersion, setSelectedVersion] = useState<ToolVersion | null>(null);
  const [compareVersions, setCompareVersions] = useState<[ToolVersion, ToolVersion] | null>(null);

  const handleViewSchema = (version: ToolVersion) => {
    setSelectedVersion(version);
  };

  const handleCompare = (v1: ToolVersion, v2: ToolVersion) => {
    setCompareVersions([v1, v2]);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Schema Versions</CardTitle>
          <CardDescription>Version history for this tool&apos;s schema</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Version</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Created By</TableHead>
                <TableHead>Changelog</TableHead>
                <TableHead className="w-[120px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <SkeletonTableRow columns={5} />
              <SkeletonTableRow columns={5} />
              <SkeletonTableRow columns={5} />
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Schema Versions</CardTitle>
          <CardDescription>
            {versions?.length || 0} version{(versions?.length || 0) !== 1 ? "s" : ""} available
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[120px]">Version</TableHead>
                <TableHead className="w-[180px]">Created</TableHead>
                <TableHead className="w-[150px]">Created By</TableHead>
                <TableHead>Changelog</TableHead>
                <TableHead className="w-[150px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!versions || versions.length === 0 ? (
                <EmptyRow colSpan={5} message="No versions found" />
              ) : (
                versions.map((version, index) => (
                  <VersionRow
                    key={version.id}
                    version={version}
                    isLatest={index === 0}
                    previousVersion={index < versions.length - 1 ? versions[index + 1] : undefined}
                    onView={() => handleViewSchema(version)}
                    onCompare={
                      index < versions.length - 1
                        ? () => handleCompare(version, versions[index + 1])
                        : undefined
                    }
                  />
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* View Schema Dialog */}
      <Dialog open={!!selectedVersion} onOpenChange={() => setSelectedVersion(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileJson className="h-5 w-5 text-accent-blue" />
              Schema Version {selectedVersion?.version}
            </DialogTitle>
            <DialogDescription>
              Created {selectedVersion && formatDateTime(selectedVersion.created_at)}
              {selectedVersion?.created_by && ` by ${selectedVersion.created_by}`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            {selectedVersion && (
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium mb-2">Input Schema</h4>
                  <JsonViewer
                    data={selectedVersion.input_schema}
                    collapsed={1}
                    searchable
                    maxHeight={300}
                  />
                </div>
                {selectedVersion.output_schema && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">Output Schema</h4>
                    <JsonViewer
                      data={selectedVersion.output_schema}
                      collapsed={1}
                      searchable
                      maxHeight={200}
                    />
                  </div>
                )}
                {selectedVersion.changelog && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">Changelog</h4>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap p-3 rounded-lg bg-background-secondary">
                      {selectedVersion.changelog}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Compare Dialog */}
      <Dialog open={!!compareVersions} onOpenChange={() => setCompareVersions(null)}>
        <DialogContent className="max-w-5xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5 text-accent-blue" />
              Compare Versions
            </DialogTitle>
            <DialogDescription>
              {compareVersions && (
                <>
                  Comparing v{compareVersions[0].version} with v{compareVersions[1].version}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            {compareVersions && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className="bg-accent-green/10 text-accent-green border-accent-green/30">
                      v{compareVersions[0].version}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatTimeAgo(compareVersions[0].created_at)}
                    </span>
                  </div>
                  <JsonViewer
                    data={compareVersions[0].input_schema}
                    collapsed={1}
                    maxHeight={400}
                  />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className="bg-accent-yellow/10 text-accent-yellow border-accent-yellow/30">
                      v{compareVersions[1].version}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatTimeAgo(compareVersions[1].created_at)}
                    </span>
                  </div>
                  <JsonViewer
                    data={compareVersions[1].input_schema}
                    collapsed={1}
                    maxHeight={400}
                  />
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface VersionRowProps {
  version: ToolVersion;
  isLatest: boolean;
  previousVersion?: ToolVersion;
  onView: () => void;
  onCompare?: () => void;
}

function VersionRow({ version, isLatest, previousVersion, onView, onCompare }: VersionRowProps) {
  return (
    <TableRow className="group">
      <TableCell>
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono">v{version.version}</span>
          {isLatest && (
            <Badge variant="secondary" className="text-xs bg-accent-blue/10 text-accent-blue">
              Latest
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          <span title={formatDateTime(version.created_at)}>
            {formatTimeAgo(version.created_at)}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <User className="h-3.5 w-3.5" />
          <span>{version.created_by || "System"}</span>
        </div>
      </TableCell>
      <TableCell>
        <span className="text-sm text-muted-foreground line-clamp-1">
          {version.changelog || "-"}
        </span>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="sm" onClick={onView}>
            <Eye className="h-4 w-4 mr-1" />
            View
          </Button>
          {onCompare && (
            <Button variant="ghost" size="sm" onClick={onCompare}>
              <ArrowLeftRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
