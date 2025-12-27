"use client";

import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

export function ConnectionStatus() {
  const { isError, isLoading } = useQuery({
    queryKey: ["health"],
    queryFn: () => fetch("/api/health").then((r) => r.json()),
    refetchInterval: 10000,
    retry: false,
  });

  const status = isLoading ? "connecting" : isError ? "disconnected" : "connected";

  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          status === "connected" && "bg-accent-green animate-pulse",
          status === "disconnected" && "bg-accent-red",
          status === "connecting" && "bg-accent-yellow"
        )}
      />
      <span className="text-muted-foreground">
        {status === "connected"
          ? "Connected"
          : status === "disconnected"
          ? "Disconnected"
          : "Connecting..."}
      </span>
    </div>
  );
}
