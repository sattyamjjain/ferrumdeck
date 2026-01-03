"use client";

import { useEffect, useState } from "react";
import {
  Server,
  Database,
  Cpu,
  Container,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LogViewer } from "@/components/logs/log-viewer";

interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  state: "running" | "exited" | "paused" | "restarting";
  created: string;
  ports: string;
}

// Icon mapping for known container types
function getContainerIcon(name: string) {
  if (name.includes("postgres")) return Database;
  if (name.includes("redis")) return Database;
  if (name.includes("gateway")) return Server;
  if (name.includes("worker")) return Cpu;
  if (name.includes("dashboard")) return Server;
  return Container;
}

// Color mapping for container states
function getStateColor(state: string) {
  switch (state) {
    case "running":
      return "text-green-400 bg-green-500/10 border-green-500/30";
    case "exited":
      return "text-red-400 bg-red-500/10 border-red-500/30";
    case "paused":
      return "text-yellow-400 bg-yellow-500/10 border-yellow-500/30";
    case "restarting":
      return "text-blue-400 bg-blue-500/10 border-blue-500/30";
    default:
      return "text-muted-foreground bg-muted/50 border-border";
  }
}

export default function LogsPage() {
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [selectedContainer, setSelectedContainer] = useState<ContainerInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch containers
  const fetchContainers = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch("/api/v1/docker/containers");

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to fetch containers");
      }

      const data = await response.json();
      setContainers(data.containers || []);

      // Auto-select first running container
      if (!selectedContainer && data.containers?.length > 0) {
        const runningContainer = data.containers.find(
          (c: ContainerInfo) => c.state === "running"
        );
        setSelectedContainer(runningContainer || data.containers[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchContainers();
    // Refresh container list every 30 seconds
    const interval = setInterval(fetchContainers, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-border bg-gradient-to-r from-background to-background-secondary">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent-primary/10 border border-accent-primary/20">
              <Container className="h-5 w-5 text-accent-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Container Logs</h1>
              <p className="text-sm text-muted-foreground">
                Real-time log streaming from Docker containers
              </p>
            </div>
          </div>

          <button
            onClick={fetchContainers}
            disabled={isLoading}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm",
              "bg-background-secondary border border-border",
              "hover:bg-accent-primary/10 hover:border-accent-primary/30",
              "transition-colors duration-200",
              isLoading && "opacity-50 cursor-not-allowed"
            )}
          >
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 min-h-0">
        {/* Container Sidebar */}
        <div className="w-64 shrink-0 border-r border-border bg-background-secondary/30 overflow-y-auto">
          <div className="p-3">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Containers ({containers.length})
            </div>

            {isLoading && containers.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <div className="flex items-center gap-2 text-red-400 text-sm">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              </div>
            ) : containers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No containers found
              </div>
            ) : (
              <div className="space-y-1">
                {containers.map((container) => {
                  const Icon = getContainerIcon(container.name);
                  const isSelected = selectedContainer?.id === container.id;

                  return (
                    <button
                      key={container.id}
                      onClick={() => setSelectedContainer(container)}
                      className={cn(
                        "w-full flex items-center gap-3 p-2.5 rounded-lg text-left",
                        "transition-all duration-200",
                        isSelected
                          ? "bg-accent-primary/15 border border-accent-primary/30 shadow-sm"
                          : "hover:bg-background-secondary border border-transparent"
                      )}
                    >
                      <div
                        className={cn(
                          "p-1.5 rounded-md",
                          isSelected
                            ? "bg-accent-primary/20 text-accent-primary"
                            : "bg-muted/50 text-muted-foreground"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">
                          {container.name.replace("fd-", "")}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border",
                              getStateColor(container.state)
                            )}
                          >
                            {container.state === "running" ? (
                              <CheckCircle className="h-2.5 w-2.5" />
                            ) : (
                              <AlertCircle className="h-2.5 w-2.5" />
                            )}
                            {container.state}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Log Viewer */}
        <div className="flex-1 min-w-0">
          {selectedContainer ? (
            <LogViewer
              key={selectedContainer.id}
              container={selectedContainer.id}
              containerName={selectedContainer.name}
              tail={200}
              className="h-full"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center">
                <Container className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Select a container to view logs</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
