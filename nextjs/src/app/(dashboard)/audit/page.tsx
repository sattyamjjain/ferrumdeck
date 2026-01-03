"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Search,
  Download,
  FileText,
  RefreshCw,
  Filter,
  Clock,
  Activity,
  AlertCircle,
  ChevronDown,
  X,
  Calendar,
  ListFilter,
} from "lucide-react";
import { SkeletonRow } from "@/components/shared/loading-spinner";
import { EmptyState } from "@/components/shared/empty-state";
import { AuditTimeline } from "@/components/audit/audit-timeline";
import { AuditEventDrawer } from "@/components/audit/audit-event-drawer";
import {
  useAuditEvents,
  useExportAudit,
  getTimeRangeDate,
  getEventTypeDisplayName,
  getEventTypesByCategory,
} from "@/hooks/use-audit";
import type { AuditEvent, AuditEventType, AuditActorType, AuditEventFilters } from "@/types/audit";
import { AUDIT_SAVED_VIEWS } from "@/types/audit";
import { cn } from "@/lib/utils";

// ============================================================================
// Filter Bar Component
// ============================================================================

interface FilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  selectedEventTypes: AuditEventType[];
  onEventTypesChange: (types: AuditEventType[]) => void;
  actorType: AuditActorType | "all";
  onActorTypeChange: (type: AuditActorType | "all") => void;
  timeRange: string;
  onTimeRangeChange: (range: string) => void;
  onReset: () => void;
}

function FilterBar({
  search,
  onSearchChange,
  selectedEventTypes,
  onEventTypesChange,
  actorType,
  onActorTypeChange,
  timeRange,
  onTimeRangeChange,
  onReset,
}: FilterBarProps) {
  const eventTypesByCategory = getEventTypesByCategory();

  const toggleEventType = useCallback(
    (type: AuditEventType) => {
      if (selectedEventTypes.includes(type)) {
        onEventTypesChange(selectedEventTypes.filter((t) => t !== type));
      } else {
        onEventTypesChange([...selectedEventTypes, type]);
      }
    },
    [selectedEventTypes, onEventTypesChange]
  );

  const selectCategory = useCallback(
    (category: string) => {
      const categoryTypes = eventTypesByCategory[category] || [];
      const allSelected = categoryTypes.every((t) => selectedEventTypes.includes(t));
      if (allSelected) {
        onEventTypesChange(selectedEventTypes.filter((t) => !categoryTypes.includes(t)));
      } else {
        const newTypes = [...new Set([...selectedEventTypes, ...categoryTypes])];
        onEventTypesChange(newTypes);
      }
    },
    [eventTypesByCategory, selectedEventTypes, onEventTypesChange]
  );

  const hasFilters =
    search || selectedEventTypes.length > 0 || actorType !== "all" || timeRange !== "7d";

  return (
    <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-700/50">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Filters</span>
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onReset}
              className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3 mr-1" />
              Clear all
            </Button>
          )}
        </div>
        <div className="grid gap-3 md:grid-cols-5">
          {/* Search */}
          <div className="relative md:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by event, actor, target..."
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-9 bg-slate-900/50 border-slate-700"
            />
          </div>

          {/* Event Type Multi-Select */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="bg-slate-900/50 border-slate-700 justify-between"
              >
                <div className="flex items-center gap-2">
                  <ListFilter className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {selectedEventTypes.length === 0
                      ? "All Events"
                      : `${selectedEventTypes.length} selected`}
                  </span>
                </div>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="start">
              <div className="max-h-80 overflow-y-auto p-2">
                {Object.entries(eventTypesByCategory).map(([category, types]) => (
                  <div key={category} className="mb-2">
                    <button
                      onClick={() => selectCategory(category)}
                      className="flex items-center justify-between w-full px-2 py-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <span>{category.replace(/_/g, " ")}</span>
                      <span className="text-[10px] normal-case">
                        {types.filter((t) => selectedEventTypes.includes(t)).length}/{types.length}
                      </span>
                    </button>
                    <div className="space-y-0.5">
                      {types.map((type) => (
                        <button
                          key={type}
                          onClick={() => toggleEventType(type)}
                          className={cn(
                            "flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-sm transition-colors",
                            selectedEventTypes.includes(type)
                              ? "bg-primary/10 text-primary"
                              : "hover:bg-slate-800"
                          )}
                        >
                          <div
                            className={cn(
                              "h-3 w-3 rounded-sm border",
                              selectedEventTypes.includes(type)
                                ? "bg-primary border-primary"
                                : "border-slate-600"
                            )}
                          >
                            {selectedEventTypes.includes(type) && (
                              <svg viewBox="0 0 12 12" className="h-3 w-3 text-primary-foreground">
                                <path
                                  d="M9.5 3.5L5 8L2.5 5.5"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  fill="none"
                                />
                              </svg>
                            )}
                          </div>
                          <span>{getEventTypeDisplayName(type)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {selectedEventTypes.length > 0 && (
                <div className="border-t border-slate-800 p-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onEventTypesChange([])}
                    className="w-full"
                  >
                    Clear selection
                  </Button>
                </div>
              )}
            </PopoverContent>
          </Popover>

          {/* Actor Type */}
          <Select value={actorType} onValueChange={(v) => onActorTypeChange(v as AuditActorType | "all")}>
            <SelectTrigger className="bg-slate-900/50 border-slate-700">
              <SelectValue placeholder="Actor Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actors</SelectItem>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="agent">Agent</SelectItem>
              <SelectItem value="system">System</SelectItem>
              <SelectItem value="api_key">API Key</SelectItem>
            </SelectContent>
          </Select>

          {/* Time Range */}
          <Select value={timeRange} onValueChange={onTimeRangeChange}>
            <SelectTrigger className="bg-slate-900/50 border-slate-700">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <SelectValue placeholder="Time Range" />
              </div>
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
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Saved Views Component
// ============================================================================

interface SavedViewsProps {
  activeView: string;
  onViewChange: (viewId: string) => void;
}

function SavedViews({ activeView, onViewChange }: SavedViewsProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {AUDIT_SAVED_VIEWS.map((view) => (
        <Button
          key={view.id}
          variant={activeView === view.id ? "secondary" : "ghost"}
          size="sm"
          onClick={() => onViewChange(view.id)}
          className={cn(
            "transition-colors",
            activeView === view.id
              ? "bg-slate-800 text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {view.name}
        </Button>
      ))}
    </div>
  );
}

// ============================================================================
// Stats Cards Component
// ============================================================================

interface StatsCardsProps {
  total: number;
  today: number;
  errors: number;
}

function StatsCards({ total, today, errors }: StatsCardsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-700/50">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <Activity className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Events</p>
              <p className="text-2xl font-semibold">{total.toLocaleString()}</p>
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
              <p className="text-2xl font-semibold">{today.toLocaleString()}</p>
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
              <p className="text-2xl font-semibold">{errors.toLocaleString()}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Export Dropdown Component
// ============================================================================

interface ExportDropdownProps {
  onExport: (format: "csv" | "json") => void;
  isExporting: boolean;
  disabled: boolean;
}

function ExportDropdown({ onExport, isExporting, disabled }: ExportDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled || isExporting} className="gap-2">
          <Download className="h-4 w-4" />
          {isExporting ? "Exporting..." : "Export"}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Export Format</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onExport("csv")}>
          <FileText className="h-4 w-4 mr-2" />
          Export as CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onExport("json")}>
          <FileText className="h-4 w-4 mr-2" />
          Export as JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ============================================================================
// Main Page Component
// ============================================================================

export default function AuditPage() {
  // Hydration fix - ensure client-only rendering for Radix components
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Filter state
  const [search, setSearch] = useState("");
  const [selectedEventTypes, setSelectedEventTypes] = useState<AuditEventType[]>([]);
  const [actorType, setActorType] = useState<AuditActorType | "all">("all");
  const [timeRange, setTimeRange] = useState("7d");
  const [activeView, setActiveView] = useState("all");

  // Drawer state
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Build filters based on selections
  const filters: AuditEventFilters = useMemo(() => {
    const f: AuditEventFilters = {};

    if (search) f.search = search;
    if (selectedEventTypes.length > 0) f.event_types = selectedEventTypes;
    if (actorType !== "all") f.actor_type = actorType;
    if (timeRange !== "all") f.start_date = getTimeRangeDate(timeRange);

    return f;
  }, [search, selectedEventTypes, actorType, timeRange]);

  // Fetch audit events with infinite query
  const {
    data,
    isLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useAuditEvents(filters);

  // Export mutation
  const exportMutation = useExportAudit();

  // Flatten paginated data
  const allEvents = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flatMap((page) => page.events);
  }, [data]);

  // Calculate stats
  const stats = useMemo(() => {
    if (allEvents.length === 0) return { total: 0, today: 0, errors: 0 };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const eventType = (e: AuditEvent) => e.event_type || e.action;

    return {
      total: allEvents.length,
      today: allEvents.filter((e) => new Date(e.occurred_at) >= today).length,
      errors: allEvents.filter((e) => {
        const type = eventType(e);
        return (
          type.includes("failed") ||
          type.includes("rejected") ||
          type.includes("denied") ||
          type.includes("timeout") ||
          type.includes("killed")
        );
      }).length,
    };
  }, [allEvents]);

  // Handle saved view change
  const handleViewChange = useCallback((viewId: string) => {
    setActiveView(viewId);
    const view = AUDIT_SAVED_VIEWS.find((v) => v.id === viewId);
    if (view) {
      setSelectedEventTypes(view.filters.event_types || []);
      setActorType(view.filters.actor_type || "all");
      // Keep current time range and search
    }
  }, []);

  // Handle filter reset
  const handleReset = useCallback(() => {
    setSearch("");
    setSelectedEventTypes([]);
    setActorType("all");
    setTimeRange("7d");
    setActiveView("all");
  }, []);

  // Handle event click
  const handleEventClick = useCallback((event: AuditEvent) => {
    setSelectedEvent(event);
    setDrawerOpen(true);
  }, []);

  // Handle export
  const handleExport = useCallback(
    (format: "csv" | "json") => {
      exportMutation.mutate({
        filters,
        format,
        date_range: timeRange !== "all" ? {
          start: getTimeRangeDate(timeRange) || new Date().toISOString(),
          end: new Date().toISOString(),
        } : undefined,
      });
    },
    [filters, timeRange, exportMutation]
  );

  // Client-side export fallback (when API doesn't support export)
  const handleClientExport = useCallback(
    (format: "csv" | "json") => {
      if (allEvents.length === 0) return;

      let content: string;
      let mimeType: string;

      if (format === "json") {
        content = JSON.stringify(allEvents, null, 2);
        mimeType = "application/json";
      } else {
        // CSV export
        const headers = [
          "id",
          "event_type",
          "actor_type",
          "actor_id",
          "actor_name",
          "target_type",
          "target_id",
          "description",
          "occurred_at",
          "run_id",
          "trace_id",
        ];
        const rows = allEvents.map((event) =>
          headers
            .map((h) => {
              const value = event[h as keyof AuditEvent];
              if (value === undefined || value === null) return "";
              if (typeof value === "object") return JSON.stringify(value);
              return String(value).replace(/"/g, '""');
            })
            .map((v) => `"${v}"`)
            .join(",")
        );
        content = [headers.join(","), ...rows].join("\n");
        mimeType = "text/csv";
      }

      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-logs-${new Date().toISOString().split("T")[0]}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    [allEvents]
  );

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
              disabled={isLoading}
              className="gap-2"
            >
              <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
              Refresh
            </Button>
            {mounted && (
              <ExportDropdown
                onExport={handleClientExport}
                isExporting={exportMutation.isPending}
                disabled={allEvents.length === 0}
              />
            )}
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <StatsCards total={stats.total} today={stats.today} errors={stats.errors} />

      {/* Saved Views */}
      <div className="flex items-center justify-between">
        <SavedViews activeView={activeView} onViewChange={handleViewChange} />
        <div className="text-sm text-muted-foreground">
          {isLoading
            ? "Loading..."
            : `${allEvents.length.toLocaleString()} events`}
        </div>
      </div>

      {/* Filter Bar */}
      {mounted && (
        <FilterBar
          search={search}
          onSearchChange={setSearch}
          selectedEventTypes={selectedEventTypes}
          onEventTypesChange={setSelectedEventTypes}
          actorType={actorType}
          onActorTypeChange={setActorType}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          onReset={handleReset}
        />
      )}

      {/* Selected Filters Display */}
      {selectedEventTypes.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground">Filtering by:</span>
          {selectedEventTypes.slice(0, 5).map((type) => (
            <Badge
              key={type}
              variant="secondary"
              className="gap-1 bg-slate-800 hover:bg-slate-700 cursor-pointer"
              onClick={() => setSelectedEventTypes(selectedEventTypes.filter((t) => t !== type))}
            >
              {getEventTypeDisplayName(type)}
              <X className="h-3 w-3" />
            </Badge>
          ))}
          {selectedEventTypes.length > 5 && (
            <Badge variant="secondary" className="bg-slate-800">
              +{selectedEventTypes.length - 5} more
            </Badge>
          )}
        </div>
      )}

      {/* Audit Timeline */}
      {isLoading && allEvents.length === 0 ? (
        <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-700/50">
          <CardContent className="p-0">
            <div className="space-y-0">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="px-4 py-3 border-b border-slate-800/50">
                  <SkeletonRow />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
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
      ) : (
        <AuditTimeline
          events={allEvents}
          isLoading={isFetchingNextPage}
          hasMore={hasNextPage}
          onLoadMore={() => fetchNextPage()}
          onEventClick={handleEventClick}
          className="h-[600px]"
        />
      )}

      {/* Event Detail Drawer */}
      <AuditEventDrawer
        event={selectedEvent}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </div>
  );
}
