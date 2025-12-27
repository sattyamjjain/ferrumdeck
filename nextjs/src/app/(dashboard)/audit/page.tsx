"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Search,
  Download,
  FileText,
  Shield,
  Key,
  Play,
  AlertCircle,
  User,
  Bot,
  Settings,
  RefreshCw,
  Filter,
  Clock,
  Activity,
  CheckCircle,
  XCircle,
  PauseCircle,
  Wrench,
} from "lucide-react";
import { LoadingSpinner, SkeletonRow } from "@/components/shared/loading-spinner";
import { EmptyState } from "@/components/shared/empty-state";
import {
  useAuditEvents,
  getActionDisplayName,
  getActorTypeDisplayName,
  getResourceTypeDisplayName,
  type AuditAction,
  type AuditActorType,
  type AuditEventFilters,
} from "@/hooks/use-audit";
import type { AuditEvent } from "@/types";

function getEventIcon(action: AuditAction) {
  if (action.startsWith("run.")) return <Play className="h-3.5 w-3.5" />;
  if (action.startsWith("step.")) return <Activity className="h-3.5 w-3.5" />;
  if (action.startsWith("approval.")) return <Shield className="h-3.5 w-3.5" />;
  if (action.startsWith("agent.")) return <Bot className="h-3.5 w-3.5" />;
  if (action.startsWith("tool.")) return <Wrench className="h-3.5 w-3.5" />;
  if (action.startsWith("api_key.")) return <Key className="h-3.5 w-3.5" />;
  if (action.startsWith("policy.")) return <FileText className="h-3.5 w-3.5" />;
  if (action.startsWith("settings.")) return <Settings className="h-3.5 w-3.5" />;
  return <AlertCircle className="h-3.5 w-3.5" />;
}

function getActorIcon(actorType: AuditActorType) {
  switch (actorType) {
    case "user":
      return <User className="h-3.5 w-3.5" />;
    case "api_key":
      return <Key className="h-3.5 w-3.5" />;
    case "agent":
      return <Bot className="h-3.5 w-3.5" />;
    case "system":
      return <Settings className="h-3.5 w-3.5" />;
    default:
      return <User className="h-3.5 w-3.5" />;
  }
}

function getActionBadgeStyle(action: AuditAction): string {
  if (action.includes("created") || action.includes("started")) {
    return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  }
  if (action.includes("completed") || action.includes("approved")) {
    return "bg-blue-500/10 text-blue-400 border-blue-500/20";
  }
  if (action.includes("failed") || action.includes("rejected") || action.includes("revoked")) {
    return "bg-red-500/10 text-red-400 border-red-500/20";
  }
  if (action.includes("updated") || action.includes("version")) {
    return "bg-amber-500/10 text-amber-400 border-amber-500/20";
  }
  if (action.includes("archived") || action.includes("disabled") || action.includes("deleted")) {
    return "bg-slate-500/10 text-slate-400 border-slate-500/20";
  }
  if (action.includes("expired") || action.includes("cancelled")) {
    return "bg-orange-500/10 text-orange-400 border-orange-500/20";
  }
  if (action.includes("requested")) {
    return "bg-purple-500/10 text-purple-400 border-purple-500/20";
  }
  return "bg-slate-500/10 text-slate-400 border-slate-500/20";
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getTimeRangeDate(range: string): string | undefined {
  const now = new Date();
  switch (range) {
    case "1h":
      return new Date(now.getTime() - 3600000).toISOString();
    case "24h":
      return new Date(now.getTime() - 86400000).toISOString();
    case "7d":
      return new Date(now.getTime() - 604800000).toISOString();
    case "30d":
      return new Date(now.getTime() - 2592000000).toISOString();
    case "90d":
      return new Date(now.getTime() - 7776000000).toISOString();
    default:
      return undefined;
  }
}

export default function AuditPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [eventCategory, setEventCategory] = useState("all");
  const [timeRange, setTimeRange] = useState("7d");

  // Build filters based on selections
  const filters: AuditEventFilters = useMemo(() => {
    const f: AuditEventFilters = {};

    if (timeRange !== "all") {
      f.start_date = getTimeRangeDate(timeRange);
    }

    return f;
  }, [timeRange]);

  const { data, isLoading, error, refetch } = useAuditEvents(filters);

  // Filter events client-side for search and category
  const filteredEvents = useMemo(() => {
    if (!data?.events) return [];

    return data.events.filter((event) => {
      // Category filter
      if (eventCategory !== "all") {
        const [category] = event.action.split(".");
        if (category !== eventCategory) return false;
      }

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          event.action.toLowerCase().includes(query) ||
          event.actor_id.toLowerCase().includes(query) ||
          event.actor_name?.toLowerCase().includes(query) ||
          event.resource_id.toLowerCase().includes(query) ||
          JSON.stringify(event.details).toLowerCase().includes(query)
        );
      }

      return true;
    });
  }, [data?.events, eventCategory, searchQuery]);

  // Export function
  const handleExport = () => {
    if (!filteredEvents.length) return;

    const blob = new Blob([JSON.stringify(filteredEvents, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-logs-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Stats for header
  const stats = useMemo(() => {
    if (!data?.events) return { total: 0, today: 0, errors: 0 };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return {
      total: data.events.length,
      today: data.events.filter((e) => new Date(e.occurred_at) >= today).length,
      errors: data.events.filter(
        (e) => e.action.includes("failed") || e.action.includes("rejected")
      ).length,
    };
  }, [data?.events]);

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Page header with gradient accent */}
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/5 via-transparent to-transparent rounded-xl -z-10" />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 pb-2">
            <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
              <FileText className="h-5 w-5 text-indigo-400" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Audit Logs</h1>
              <p className="text-sm text-muted-foreground">
                View and export activity logs for compliance and debugging
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={!filteredEvents.length}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Export JSON
            </Button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-700/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Activity className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Events</p>
                <p className="text-2xl font-semibold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-700/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <Clock className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Today</p>
                <p className="text-2xl font-semibold">{stats.today}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-700/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/10">
                <AlertCircle className="h-5 w-5 text-red-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Errors</p>
                <p className="text-2xl font-semibold">{stats.errors}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-700/50">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Filters</span>
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search events..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-slate-900/50 border-slate-700"
              />
            </div>
            <Select value={eventCategory} onValueChange={setEventCategory}>
              <SelectTrigger className="bg-slate-900/50 border-slate-700">
                <SelectValue placeholder="Event Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Events</SelectItem>
                <SelectItem value="run">Run Events</SelectItem>
                <SelectItem value="step">Step Events</SelectItem>
                <SelectItem value="approval">Approval Events</SelectItem>
                <SelectItem value="agent">Agent Events</SelectItem>
                <SelectItem value="tool">Tool Events</SelectItem>
                <SelectItem value="api_key">API Key Events</SelectItem>
                <SelectItem value="policy">Policy Events</SelectItem>
                <SelectItem value="settings">Settings Events</SelectItem>
              </SelectContent>
            </Select>
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="bg-slate-900/50 border-slate-700">
                <SelectValue placeholder="Time Range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1h">Last Hour</SelectItem>
                <SelectItem value="24h">Last 24 Hours</SelectItem>
                <SelectItem value="7d">Last 7 Days</SelectItem>
                <SelectItem value="30d">Last 30 Days</SelectItem>
                <SelectItem value="90d">Last 90 Days</SelectItem>
                <SelectItem value="all">All Time</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="secondary"
              onClick={() => {
                setSearchQuery("");
                setEventCategory("all");
                setTimeRange("7d");
              }}
              className="bg-slate-800 hover:bg-slate-700"
            >
              Reset Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Activity Log Table */}
      <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-700/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Activity Log</CardTitle>
              <CardDescription>
                {isLoading
                  ? "Loading events..."
                  : `Showing ${filteredEvents.length} events`}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <SkeletonRow key={i} />
              ))}
            </div>
          ) : error ? (
            <EmptyState
              icon={AlertCircle}
              title="Failed to load audit logs"
              description="There was an error fetching the audit logs. Please try again."
              action={
                <Button onClick={() => refetch()} variant="outline">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry
                </Button>
              }
            />
          ) : filteredEvents.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No audit events found"
              description={
                searchQuery || eventCategory !== "all"
                  ? "Try adjusting your filters to see more events."
                  : "Audit events will appear here as activity occurs in the system."
              }
            />
          ) : (
            <div className="rounded-lg border border-slate-700/50 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-slate-700/50">
                    <TableHead className="w-[140px] text-slate-400">Time</TableHead>
                    <TableHead className="w-[180px] text-slate-400">Event</TableHead>
                    <TableHead className="w-[160px] text-slate-400">Actor</TableHead>
                    <TableHead className="w-[180px] text-slate-400">Resource</TableHead>
                    <TableHead className="text-slate-400">Details</TableHead>
                    <TableHead className="w-[100px] text-slate-400">Trace</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEvents.map((event, index) => (
                    <TableRow
                      key={event.id}
                      className="hover:bg-slate-800/50 border-slate-700/50 animate-fade-in"
                      style={{ animationDelay: `${index * 20}ms` }}
                    >
                      <TableCell className="py-3">
                        <div className="flex items-center gap-2">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">
                            {formatTimestamp(event.occurred_at)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`gap-1.5 font-medium ${getActionBadgeStyle(event.action)}`}
                        >
                          {getEventIcon(event.action)}
                          {getActionDisplayName(event.action)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="p-1 rounded bg-slate-800">
                            {getActorIcon(event.actor_type)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {event.actor_name || event.actor_id}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {getActorTypeDisplayName(event.actor_type)}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="min-w-0">
                          <p className="text-sm text-muted-foreground">
                            {getResourceTypeDisplayName(event.resource_type)}
                          </p>
                          <p className="text-xs font-mono text-slate-500 truncate">
                            {event.resource_id}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm text-muted-foreground truncate max-w-[300px]">
                          {Object.keys(event.details).length > 0
                            ? JSON.stringify(event.details)
                            : "—"}
                        </p>
                      </TableCell>
                      <TableCell>
                        {event.trace_id ? (
                          <code className="text-xs font-mono text-slate-500 bg-slate-800/50 px-1.5 py-0.5 rounded">
                            {event.trace_id.slice(0, 8)}...
                          </code>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
