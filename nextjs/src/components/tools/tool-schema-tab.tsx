"use client";

import { useToolVersions } from "@/hooks/use-tools";
import { ToolSchemaViewer } from "./tool-schema-viewer";
import type { ToolDetail } from "@/types/tool";

interface ToolSchemaTabProps {
  toolId: string;
  tool: ToolDetail;
}

export function ToolSchemaTab({ toolId, tool }: ToolSchemaTabProps) {
  const { data: versions = [], isLoading } = useToolVersions(toolId);

  // Get current version from tool or versions list
  const currentVersion = tool.latest_version || (versions.length > 0 ? versions[0] : undefined);

  return (
    <ToolSchemaViewer
      currentVersion={currentVersion}
      versions={versions}
      isLoading={isLoading}
    />
  );
}
