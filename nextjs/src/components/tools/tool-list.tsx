"use client";

import { Wrench } from "lucide-react";
import { useTools } from "@/hooks/use-tools";
import { ToolCard } from "./tool-card";
import { LoadingPage } from "@/components/shared/loading-spinner";
import { EmptyState } from "@/components/shared/empty-state";

export function ToolList() {
  const { data: tools, isLoading, error } = useTools();

  if (isLoading) {
    return <LoadingPage />;
  }

  if (error) {
    return (
      <EmptyState
        icon={Wrench}
        title="Failed to load tools"
        description="Unable to connect to the server. Please check your connection."
      />
    );
  }

  if (!tools || tools.length === 0) {
    return (
      <EmptyState
        icon={Wrench}
        title="No tools registered"
        description="Tools will appear here once MCP servers are connected"
      />
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {tools.map((tool) => (
        <ToolCard key={tool.id} tool={tool} />
      ))}
    </div>
  );
}
