"use client";

import { Play } from "lucide-react";
import { RunList } from "@/components/runs/run-list";

export default function RunsPage() {
  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Page header with gradient accent */}
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-accent-blue/5 via-transparent to-transparent rounded-xl -z-10" />
        <div className="flex items-center gap-3 pb-2">
          <div className="p-2.5 rounded-xl bg-accent-blue/10 border border-accent-blue/20">
            <Play className="h-5 w-5 text-accent-blue" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Agent Runs</h1>
            <p className="text-sm text-muted-foreground">
              Monitor and manage AI agent executions in real-time
            </p>
          </div>
        </div>
      </div>

      <RunList />
    </div>
  );
}
