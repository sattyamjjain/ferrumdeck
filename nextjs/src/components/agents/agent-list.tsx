"use client";

import { Bot } from "lucide-react";
import { AgentCard } from "./agent-card";
import { LoadingPage } from "@/components/shared/loading-spinner";
import { EmptyState } from "@/components/shared/empty-state";
import type { Agent } from "@/types/agent";

interface AgentListProps {
  agents?: Agent[];
  isLoading?: boolean;
  error?: Error | null;
}

export function AgentList({ agents, isLoading, error }: AgentListProps) {
  if (isLoading) {
    return <LoadingPage />;
  }

  if (error) {
    return (
      <EmptyState
        icon={Bot}
        title="Failed to load agents"
        description="Unable to connect to the server. Please check your connection."
      />
    );
  }

  if (!agents || agents.length === 0) {
    return (
      <EmptyState
        icon={Bot}
        title="No agents found"
        description="No agents match your current filters. Try adjusting your search or create a new agent."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {agents.map((agent) => (
        <AgentCard key={agent.id} agent={agent} />
      ))}
    </div>
  );
}
