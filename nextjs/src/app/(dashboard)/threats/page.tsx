"use client";

import { useState, useMemo, useCallback, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Shield,
  ShieldAlert,
  ShieldX,
  RefreshCw,
  AlertTriangle,
  ShieldOff,
} from "lucide-react";
import { SkeletonRow } from "@/components/shared/loading-spinner";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatsCard, StatsGrid } from "@/components/shared/stats-card";
import {
  ThreatTable,
  ThreatFilters,
  SecurityDetailSection,
  SecurityBadge,
} from "@/components/security";
import { useThreats } from "@/hooks/use-security";
import type { Threat, ThreatsParams } from "@/types/security";
import { cn } from "@/lib/utils";

// ============================================================================
// Main Page Component
// ============================================================================

export default function ThreatsPage() {
  return (
    <Suspense fallback={<ThreatsPageSkeleton />}>
      <ThreatsPageContent />
    </Suspense>
  );
}

function ThreatsPageSkeleton() {
  return (
    <div className="p-6 space-y-6">
      {/* Header skeleton */}
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-xl bg-secondary/50 animate-pulse" />
        <div className="space-y-2">
          <div className="h-7 w-48 rounded bg-secondary/50 animate-pulse" />
          <div className="h-4 w-72 rounded bg-secondary/30 animate-pulse" />
        </div>
      </div>

      {/* Stats skeleton */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-24 rounded-xl bg-secondary/30 animate-pulse"
            style={{ animationDelay: `${i * 100}ms` }}
          />
        ))}
      </div>

      {/* Table skeleton */}
      <div className="rounded-xl border border-border/50 overflow-hidden">
        <div className="p-4 bg-secondary/20 border-b border-border/50">
          <div className="h-4 w-24 rounded bg-secondary/40 animate-pulse" />
        </div>
        <div className="divide-y divide-border/30">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="px-4 py-3">
              <SkeletonRow />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ThreatsPageContent() {
  // Hydration fix
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  // URL params for filtering
  const searchParams = useSearchParams();
  const runIdFromUrl = searchParams.get("run_id") || undefined;

  // Filter state
  const [params, setParams] = useState<ThreatsParams>({
    limit: 50,
    offset: 0,
    run_id: runIdFromUrl,
  });

  // Sheet state for threat detail
  const [selectedThreat, setSelectedThreat] = useState<Threat | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Fetch threats
  const { data, isLoading, error, refetch } = useThreats(params);

  // Calculate stats
  const stats = useMemo(() => {
    if (!data?.threats) return { total: 0, blocked: 0, logged: 0, critical: 0 };

    return {
      total: data.total,
      blocked: data.threats.filter((t) => t.action === "blocked").length,
      logged: data.threats.filter((t) => t.action === "logged").length,
      critical: data.threats.filter((t) => t.risk_level === "critical").length,
    };
  }, [data]);

  // Handle threat click
  const handleThreatClick = useCallback((threat: Threat) => {
    setSelectedThreat(threat);
    setSheetOpen(true);
  }, []);

  // Handle filter change
  const handleFilterChange = useCallback((newParams: ThreatsParams) => {
    setParams(newParams);
  }, []);

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Page Header */}
      <PageHeader
        title="Security Threats"
        description="Airlock security violations detected across agent runs"
        icon={ShieldAlert}
        colorTheme="red"
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isLoading}
          className={cn(
            "gap-2 transition-all duration-200",
            "hover:border-accent-primary/50 hover:bg-accent-primary/5"
          )}
        >
          <RefreshCw
            className={cn(
              "h-4 w-4 transition-transform",
              isLoading && "animate-spin"
            )}
          />
          Refresh
        </Button>
      </PageHeader>

      {/* Stats Cards */}
      <StatsGrid columns={4}>
        <StatsCard
          title="Total Threats"
          value={stats.total}
          icon={Shield}
          colorTheme="indigo"
        />
        <StatsCard
          title="Blocked"
          value={stats.blocked}
          icon={ShieldX}
          colorTheme="red"
        />
        <StatsCard
          title="Logged Only"
          value={stats.logged}
          icon={ShieldOff}
          colorTheme="yellow"
        />
        <StatsCard
          title="Critical Risk"
          value={stats.critical}
          icon={AlertTriangle}
          colorTheme="red"
        />
      </StatsGrid>

      {/* Filters */}
      {mounted && (
        <Card className="overflow-hidden border-border/50 bg-background-secondary/50 backdrop-blur-sm">
          <CardContent className="p-4">
            <ThreatFilters params={params} onChange={handleFilterChange} />
          </CardContent>
        </Card>
      )}

      {/* Results count */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {isLoading
            ? "Loading..."
            : `${data?.threats?.length ?? 0} of ${stats.total} threats`}
        </div>
        {params.run_id && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Filtered to run:</span>
            <code className="px-2 py-1 rounded-md bg-background-tertiary border border-border/50 text-xs font-mono text-accent-primary">
              {params.run_id.slice(0, 12)}...
            </code>
          </div>
        )}
      </div>

      {/* Threats Table */}
      {isLoading && !data ? (
        <Card className="overflow-hidden border-border/50">
          <CardContent className="p-0">
            <div className="divide-y divide-border/30">
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className="px-4 py-3"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <SkeletonRow />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : error ? (
        <EmptyState
          icon={AlertTriangle}
          title="Failed to load threats"
          description="There was an error fetching the security threats. Please try again."
          action={
            <Button onClick={() => refetch()} variant="outline" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          }
        />
      ) : (
        <ThreatTable
          threats={data?.threats ?? []}
          onThreatClick={handleThreatClick}
        />
      )}

      {/* Pagination */}
      {data && data.total > params.limit! && (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={params.offset === 0}
            onClick={() =>
              setParams((p) => ({
                ...p,
                offset: Math.max(0, (p.offset || 0) - p.limit!),
              }))
            }
            className="min-w-[100px]"
          >
            Previous
          </Button>
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-background-secondary border border-border/50">
            <span className="text-sm text-foreground font-medium">
              {Math.floor((params.offset || 0) / params.limit!) + 1}
            </span>
            <span className="text-sm text-muted-foreground">/</span>
            <span className="text-sm text-muted-foreground">
              {Math.ceil(data.total / params.limit!)}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={(params.offset || 0) + params.limit! >= data.total}
            onClick={() =>
              setParams((p) => ({
                ...p,
                offset: (p.offset || 0) + p.limit!,
              }))
            }
            className="min-w-[100px]"
          >
            Next
          </Button>
        </div>
      )}

      {/* Threat Detail Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-[540px] sm:max-w-[540px] overflow-y-auto border-l border-border/50 bg-background/95 backdrop-blur-xl">
          <SheetHeader className="pb-4 border-b border-border/50">
            <SheetTitle className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20">
                <ShieldAlert className="h-5 w-5 text-red-400" />
              </div>
              <span>Threat Details</span>
            </SheetTitle>
            <SheetDescription>
              {selectedThreat && (
                <span className="flex items-center gap-3 mt-2">
                  <SecurityBadge
                    riskLevel={selectedThreat.risk_level}
                    size="sm"
                  />
                  <code className="px-2 py-1 rounded-md bg-background-tertiary border border-border/50 text-xs font-mono">
                    {selectedThreat.tool_name}
                  </code>
                </span>
              )}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6">
            {selectedThreat && <SecurityDetailSection threat={selectedThreat} />}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
