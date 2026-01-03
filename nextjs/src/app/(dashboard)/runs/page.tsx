import { Suspense } from "react";
import { Play } from "lucide-react";
import { RunsConsole } from "@/components/runs/runs-console";
import { RunsConsoleSkeleton } from "@/components/runs/runs-console-skeleton";

export const metadata = {
  title: "Runs | FerrumDeck",
  description: "Monitor and manage AI agent executions in real-time",
};

export default function RunsPage() {
  return (
    <div className="flex flex-col h-full">
      {/* Page header with gradient accent */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4">
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
      </div>

      {/* Main console - client component with full functionality */}
      <div className="flex-1 min-h-0 px-6 pb-6">
        <Suspense fallback={<RunsConsoleSkeleton />}>
          <RunsConsole />
        </Suspense>
      </div>
    </div>
  );
}
