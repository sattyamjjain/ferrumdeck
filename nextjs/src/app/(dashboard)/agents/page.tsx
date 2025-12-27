"use client";

import { Bot } from "lucide-react";
import { AgentList } from "@/components/agents/agent-list";
import { CreateAgentDialog } from "@/components/agents/create-agent-dialog";

export default function AgentsPage() {
  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Page header with gradient accent */}
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/5 via-transparent to-transparent rounded-xl -z-10" />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 pb-2">
            <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
              <Bot className="h-5 w-5 text-indigo-400" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Agent Registry</h1>
              <p className="text-sm text-muted-foreground">
                Configure and manage AI agent definitions
              </p>
            </div>
          </div>
          <CreateAgentDialog />
        </div>
      </div>

      <AgentList />
    </div>
  );
}
