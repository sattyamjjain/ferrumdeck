"use client";

import { useState, useMemo, useCallback } from "react";
import { Wrench } from "lucide-react";
import { useTools, useMcpServers } from "@/hooks/use-tools";
import { ToolTable } from "@/components/tools/tool-table";
import { ToolFilters } from "@/components/tools/tool-filters";
import { CreateToolDialog } from "@/components/tools/create-tool-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import type { ToolRiskLevel, ToolHealthStatus, ToolStatus } from "@/types/tool";

export default function ToolsPage() {
  // Filter state
  const [search, setSearch] = useState("");
  const [riskLevel, setRiskLevel] = useState<ToolRiskLevel | undefined>();
  const [mcpServer, setMcpServer] = useState<string | undefined>();
  const [status, setStatus] = useState<ToolStatus | undefined>();
  const [healthStatus, setHealthStatus] = useState<ToolHealthStatus | undefined>();

  // Fetch tools with filters
  const { data: tools, isLoading, error } = useTools({
    search: search || undefined,
    risk_level: riskLevel,
    mcp_server: mcpServer,
    status,
    health_status: healthStatus,
  });

  // Fetch available MCP servers for filter dropdown
  const { data: mcpServers = [] } = useMcpServers();

  // Derive unique MCP servers from tools if API doesn't provide them
  const availableMcpServers = useMemo(() => {
    if (mcpServers.length > 0) return mcpServers;
    if (!tools) return [];
    return [...new Set(tools.map((t) => t.mcp_server))].sort();
  }, [mcpServers, tools]);

  // Clear all filters
  const handleClearFilters = useCallback(() => {
    setSearch("");
    setRiskLevel(undefined);
    setMcpServer(undefined);
    setStatus(undefined);
    setHealthStatus(undefined);
  }, []);

  // Filter tools client-side if API doesn't support server-side filtering
  const filteredTools = useMemo(() => {
    if (!tools) return [];

    return tools.filter((tool) => {
      // Search filter
      if (search) {
        const searchLower = search.toLowerCase();
        const matchesSearch =
          tool.name.toLowerCase().includes(searchLower) ||
          tool.slug.toLowerCase().includes(searchLower) ||
          tool.mcp_server.toLowerCase().includes(searchLower) ||
          (tool.description?.toLowerCase().includes(searchLower) ?? false);
        if (!matchesSearch) return false;
      }

      // Risk level filter
      if (riskLevel && tool.risk_level !== riskLevel) return false;

      // MCP server filter
      if (mcpServer && tool.mcp_server !== mcpServer) return false;

      // Status filter
      if (status && tool.status !== status) return false;

      // Health status filter
      if (healthStatus && tool.health_status !== healthStatus) return false;

      return true;
    });
  }, [tools, search, riskLevel, mcpServer, status, healthStatus]);

  if (error) {
    return (
      <div className="p-6 animate-fade-in">
        <EmptyState
          icon={Wrench}
          title="Failed to load tools"
          description="Unable to connect to the server. Please check your connection."
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-accent-cyan/5 via-transparent to-transparent rounded-xl -z-10" />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 pb-2">
            <div className="p-2.5 rounded-xl bg-accent-cyan/10 border border-accent-cyan/20">
              <Wrench className="h-5 w-5 text-accent-cyan" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Tool Registry</h1>
              <p className="text-sm text-muted-foreground">
                Manage available tools, their risk classifications, and policies
              </p>
            </div>
          </div>
          <CreateToolDialog />
        </div>
      </div>

      {/* Filters */}
      <ToolFilters
        search={search}
        riskLevel={riskLevel}
        mcpServer={mcpServer}
        status={status}
        healthStatus={healthStatus}
        mcpServers={availableMcpServers}
        onSearchChange={setSearch}
        onRiskLevelChange={setRiskLevel}
        onMcpServerChange={setMcpServer}
        onStatusChange={setStatus}
        onHealthStatusChange={setHealthStatus}
        onClearFilters={handleClearFilters}
      />

      {/* Results Summary */}
      {!isLoading && tools && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {filteredTools.length === tools.length
              ? `${tools.length} tools`
              : `${filteredTools.length} of ${tools.length} tools`}
          </span>
        </div>
      )}

      {/* Tools Table */}
      {!isLoading && filteredTools.length === 0 && tools && tools.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="No tools registered"
          description="Tools will appear here once MCP servers are connected"
          action={<CreateToolDialog trigger={<span>Register your first tool</span>} />}
        />
      ) : !isLoading && filteredTools.length === 0 && tools && tools.length > 0 ? (
        <EmptyState
          icon={Wrench}
          title="No matching tools"
          description="Try adjusting your search or filters"
          actionLabel="Clear filters"
          onAction={handleClearFilters}
        />
      ) : (
        <ToolTable tools={filteredTools} isLoading={isLoading} />
      )}
    </div>
  );
}
