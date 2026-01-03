"use client";

import { useState } from "react";
import {
  FileText,
  FileJson,
  FileImage,
  File,
  Download,
  Eye,
  X,
  FileCode,
  FileArchive,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { JsonViewer } from "@/components/shared/json-viewer";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";
import type { StepArtifact } from "@/types/run";

interface ArtifactsTabProps {
  artifacts: StepArtifact[];
  className?: string;
}

export function ArtifactsTab({ artifacts, className }: ArtifactsTabProps) {
  const [previewArtifact, setPreviewArtifact] = useState<StepArtifact | null>(
    null
  );
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  if (artifacts.length === 0) {
    return (
      <EmptyState
        icon={File}
        title="No artifacts"
        description="No artifacts have been generated for this run yet."
        variant="compact"
        className={className}
      />
    );
  }

  const handlePreview = async (artifact: StepArtifact) => {
    const isPreviewable = isPreviewableType(artifact.content_type);
    if (!isPreviewable) return;

    setPreviewArtifact(artifact);
    setIsLoading(true);

    try {
      // In a real implementation, this would fetch from the storage path
      // For now, we'll show a placeholder
      const response = await fetch(`/api/v1/artifacts/${artifact.id}/content`);
      if (response.ok) {
        const text = await response.text();
        setPreviewContent(text);
      } else {
        setPreviewContent("Failed to load content");
      }
    } catch {
      setPreviewContent("Failed to load content");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = (artifact: StepArtifact) => {
    // In a real implementation, this would trigger a download from the storage path
    window.open(`/api/v1/artifacts/${artifact.id}/download`, "_blank");
  };

  const closePreview = () => {
    setPreviewArtifact(null);
    setPreviewContent(null);
  };

  return (
    <div className={cn("space-y-3", className)}>
      {artifacts.map((artifact) => (
        <ArtifactCard
          key={artifact.id}
          artifact={artifact}
          onPreview={() => handlePreview(artifact)}
          onDownload={() => handleDownload(artifact)}
        />
      ))}

      {/* Preview dialog */}
      <Dialog open={!!previewArtifact} onOpenChange={() => closePreview()}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {previewArtifact && (
                <>
                  <ArtifactIcon contentType={previewArtifact.content_type} />
                  {previewArtifact.name}
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            {isLoading ? (
              <div className="py-12 text-center text-muted-foreground">
                Loading...
              </div>
            ) : previewContent ? (
              previewArtifact?.content_type.includes("json") ? (
                <JsonViewer
                  data={JSON.parse(previewContent)}
                  maxHeight={500}
                />
              ) : (
                <pre className="p-4 bg-background-tertiary rounded-md text-sm font-mono whitespace-pre-wrap overflow-auto">
                  {previewContent}
                </pre>
              )
            ) : (
              <div className="py-12 text-center text-muted-foreground">
                No preview available
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface ArtifactCardProps {
  artifact: StepArtifact;
  onPreview: () => void;
  onDownload: () => void;
}

function ArtifactCard({ artifact, onPreview, onDownload }: ArtifactCardProps) {
  const isPreviewable = isPreviewableType(artifact.content_type);

  return (
    <Card className="hover:bg-background-tertiary/50 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="shrink-0 w-10 h-10 rounded-lg bg-background-tertiary flex items-center justify-center">
              <ArtifactIcon contentType={artifact.content_type} />
            </div>
            <div className="min-w-0">
              <p className="font-medium truncate">{artifact.name}</p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{formatContentType(artifact.content_type)}</span>
                <span>-</span>
                <span>{formatFileSize(artifact.size_bytes)}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isPreviewable && (
              <Button variant="ghost" size="sm" onClick={onPreview}>
                <Eye className="h-4 w-4 mr-1" />
                Preview
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onDownload}>
              <Download className="h-4 w-4 mr-1" />
              Download
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ArtifactIcon({
  contentType,
  className,
}: {
  contentType: string;
  className?: string;
}) {
  const iconClass = cn("h-5 w-5 text-muted-foreground", className);

  if (contentType.includes("json")) {
    return <FileJson className={iconClass} />;
  }
  if (contentType.includes("text") || contentType.includes("plain")) {
    return <FileText className={iconClass} />;
  }
  if (contentType.includes("image")) {
    return <FileImage className={iconClass} />;
  }
  if (
    contentType.includes("javascript") ||
    contentType.includes("typescript") ||
    contentType.includes("python")
  ) {
    return <FileCode className={iconClass} />;
  }
  if (contentType.includes("zip") || contentType.includes("tar")) {
    return <FileArchive className={iconClass} />;
  }
  return <File className={iconClass} />;
}

function isPreviewableType(contentType: string): boolean {
  return (
    contentType.includes("text") ||
    contentType.includes("json") ||
    contentType.includes("javascript") ||
    contentType.includes("typescript") ||
    contentType.includes("python") ||
    contentType.includes("yaml") ||
    contentType.includes("xml")
  );
}

function formatContentType(contentType: string): string {
  const parts = contentType.split("/");
  return parts[1] || parts[0] || "unknown";
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
