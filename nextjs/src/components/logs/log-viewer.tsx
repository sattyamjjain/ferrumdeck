"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Terminal,
  Pause,
  Play,
  Trash2,
  Download,
  ArrowDown,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface LogEntry {
  type: "log" | "error" | "connected" | "close";
  stream?: "stdout" | "stderr";
  message: string;
  timestamp?: string;
  container?: string;
  code?: number;
}

interface LogViewerProps {
  container: string;
  containerName: string;
  tail?: number;
  className?: string;
}

export function LogViewer({
  container,
  containerName,
  tail = 100,
  className,
}: LogViewerProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [pausedCount, setPausedCount] = useState(0);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pausedLogsRef = useRef<LogEntry[]>([]);

  // Scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && !isPaused && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll, isPaused]);

  // Connect to log stream
  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setError(null);
    setIsReconnecting(true);

    const url = `/api/v1/docker/logs/${encodeURIComponent(container)}?tail=${tail}&timestamps=true`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsConnected(true);
      setIsReconnecting(false);
    };

    eventSource.onmessage = (event) => {
      try {
        const data: LogEntry = JSON.parse(event.data);

        if (data.type === "connected") {
          setIsConnected(true);
          return;
        }

        if (data.type === "close") {
          setIsConnected(false);
          return;
        }

        if (data.type === "error") {
          setError(data.message);
          return;
        }

        if (isPaused) {
          pausedLogsRef.current.push(data);
          setPausedCount(pausedLogsRef.current.length);
        } else {
          setLogs((prev) => [...prev.slice(-2000), data]); // Keep last 2000 logs
        }
      } catch (e) {
        console.error("Failed to parse log entry:", e);
      }
    };

    eventSource.onerror = () => {
      setIsConnected(false);
      setIsReconnecting(false);
      setError("Connection lost. Click reconnect to try again.");
      eventSource.close();
    };
  }, [container, tail, isPaused]);

  // Initial connection
  useEffect(() => {
    // Defer to avoid synchronous setState during render
    const timeoutId = setTimeout(connect, 0);

    return () => {
      clearTimeout(timeoutId);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [connect]);

  // Resume and flush paused logs
  const handleResume = () => {
    setIsPaused(false);
    if (pausedLogsRef.current.length > 0) {
      setLogs((prev) => [...prev, ...pausedLogsRef.current].slice(-2000));
      pausedLogsRef.current = [];
      setPausedCount(0);
    }
  };

  // Clear logs
  const handleClear = () => {
    setLogs([]);
    pausedLogsRef.current = [];
    setPausedCount(0);
  };

  // Download logs
  const handleDownload = () => {
    const content = logs
      .map((log) => {
        const ts = log.timestamp ? `[${log.timestamp}] ` : "";
        const stream = log.stream === "stderr" ? "[ERR] " : "";
        return `${ts}${stream}${log.message}`;
      })
      .join("\n");

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${containerName}-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Handle scroll to detect if user scrolled up
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  // Format timestamp
  const formatTime = (timestamp?: string) => {
    if (!timestamp) return "";
    try {
      return new Date(timestamp).toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
      });
    } catch {
      return "";
    }
  };

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border bg-background-secondary/50">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-accent-primary" />
            <span className="font-medium text-sm">{containerName}</span>
          </div>

          {/* Connection Status */}
          <Badge
            variant="outline"
            className={cn(
              "gap-1.5 text-xs",
              isConnected
                ? "text-green-400 border-green-500/30 bg-green-500/10"
                : isReconnecting
                ? "text-yellow-400 border-yellow-500/30 bg-yellow-500/10"
                : "text-red-400 border-red-500/30 bg-red-500/10"
            )}
          >
            {isConnected ? (
              <>
                <CheckCircle className="h-3 w-3" />
                Connected
              </>
            ) : isReconnecting ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Connecting
              </>
            ) : (
              <>
                <AlertCircle className="h-3 w-3" />
                Disconnected
              </>
            )}
          </Badge>

          {/* Paused indicator */}
          {isPaused && (
            <Badge
              variant="outline"
              className="gap-1.5 text-xs text-yellow-400 border-yellow-500/30 bg-yellow-500/10"
            >
              <Pause className="h-3 w-3" />
              Paused ({pausedCount} buffered)
            </Badge>
          )}

          {/* Log count */}
          <span className="text-xs text-muted-foreground font-mono">
            {logs.length.toLocaleString()} logs
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Reconnect */}
          {!isConnected && !isReconnecting && (
            <Button
              variant="ghost"
              size="sm"
              onClick={connect}
              className="h-7 px-2 text-xs"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              Reconnect
            </Button>
          )}

          {/* Pause/Resume */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => (isPaused ? handleResume() : setIsPaused(true))}
            className="h-7 px-2 text-xs"
          >
            {isPaused ? (
              <>
                <Play className="h-3.5 w-3.5 mr-1" />
                Resume
              </>
            ) : (
              <>
                <Pause className="h-3.5 w-3.5 mr-1" />
                Pause
              </>
            )}
          </Button>

          {/* Scroll to bottom */}
          {!autoScroll && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAutoScroll(true);
                logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
              }}
              className="h-7 px-2 text-xs"
            >
              <ArrowDown className="h-3.5 w-3.5 mr-1" />
              Scroll
            </Button>
          )}

          {/* Clear */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="h-7 px-2 text-xs"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>

          {/* Download */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            className="h-7 px-2 text-xs"
            disabled={logs.length === 0}
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-red-400 text-sm flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Log Content */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto bg-[#0d1117] font-mono text-xs leading-5"
      >
        <div className="p-3 space-y-0">
          {logs.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground">
              {isConnected ? "Waiting for logs..." : "No logs available"}
            </div>
          ) : (
            logs.map((log, index) => (
              <LogLine key={index} log={log} formatTime={formatTime} />
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
}

// Individual log line component
function LogLine({
  log,
  formatTime,
}: {
  log: LogEntry;
  formatTime: (ts?: string) => string;
}) {
  const isError = log.stream === "stderr";
  const time = formatTime(log.timestamp);

  return (
    <div
      className={cn(
        "flex hover:bg-white/5 px-1 -mx-1 rounded",
        isError && "bg-red-500/5"
      )}
    >
      {/* Timestamp */}
      {time && (
        <span className="text-slate-500 select-none shrink-0 w-24">{time}</span>
      )}

      {/* Stream indicator */}
      <span
        className={cn(
          "select-none shrink-0 w-12 text-center",
          isError ? "text-red-400" : "text-green-400"
        )}
      >
        {isError ? "ERR" : "OUT"}
      </span>

      {/* Log message */}
      <span
        className={cn(
          "flex-1 break-all whitespace-pre-wrap",
          isError ? "text-red-300" : "text-slate-300"
        )}
      >
        {colorizeLogMessage(log.message)}
      </span>
    </div>
  );
}

// Colorize common log patterns
function colorizeLogMessage(message: string): React.ReactNode {
  // Highlight common patterns
  const patterns = [
    // Log levels
    { regex: /\b(ERROR|FATAL|CRITICAL)\b/gi, className: "text-red-400 font-semibold" },
    { regex: /\b(WARN|WARNING)\b/gi, className: "text-yellow-400 font-semibold" },
    { regex: /\b(INFO)\b/gi, className: "text-blue-400 font-semibold" },
    { regex: /\b(DEBUG|TRACE)\b/gi, className: "text-purple-400" },
    // HTTP methods
    { regex: /\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/g, className: "text-cyan-400 font-semibold" },
    // HTTP status codes
    { regex: /\b([45]\d{2})\b/g, className: "text-red-400" },
    { regex: /\b([23]\d{2})\b/g, className: "text-green-400" },
    // Numbers
    { regex: /\b(\d+\.?\d*)(ms|s|m|h|KB|MB|GB)\b/gi, className: "text-amber-400" },
    // URLs and paths
    { regex: /(https?:\/\/[^\s]+)/gi, className: "text-blue-300 underline" },
    // JSON-like keys
    { regex: /"(\w+)":/g, className: "text-purple-300" },
  ];

  let result: React.ReactNode = message;

  // Apply first matching pattern (simple approach)
  for (const pattern of patterns) {
    const match = message.match(pattern.regex);
    if (match) {
      const parts = message.split(pattern.regex);
      result = parts.map((part, i) => {
        if (pattern.regex.test(part)) {
          return (
            <span key={i} className={pattern.className}>
              {part}
            </span>
          );
        }
        return part;
      });
      break;
    }
  }

  return result;
}
