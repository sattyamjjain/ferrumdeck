"use client";

import { Bot } from "lucide-react";
import { useAgents } from "@/hooks/use-agents";
import { AgentCard } from "./agent-card";
import { LoadingPage } from "@/components/shared/loading-spinner";
import { EmptyState } from "@/components/shared/empty-state";

export function AgentList() {
  const { data: agents, isLoading, error } = useAgents();

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
        title="No agents yet"
        description="Create your first agent to get started"
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
