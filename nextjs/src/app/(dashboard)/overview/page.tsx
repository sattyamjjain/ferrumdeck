import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { getQueryClient } from "@/lib/query-client";
import { fetchRuns } from "@/lib/api/runs";
import { fetchApprovals } from "@/lib/api/approvals";
import { OverviewContent } from "@/components/overview/overview-content";

export const metadata = {
  title: "Overview | FerrumDeck",
  description: "Monitor your AgentOps control plane at a glance",
};

// Force dynamic rendering - this page fetches real-time data
export const dynamic = "force-dynamic";

/**
 * Overview page with SSR query prefetching.
 *
 * Prefetches runs and approvals data on the server so the client
 * receives a fully hydrated page without loading spinners.
 * If prefetch fails (e.g., during build or when API is down),
 * the client will fetch the data instead.
 */
export default async function OverviewPage() {
  const queryClient = getQueryClient();

  // Prefetch data in parallel on the server
  // Errors are silently caught - client will refetch if needed
  try {
    await Promise.all([
      queryClient.prefetchQuery({
        queryKey: ["runs", { limit: 100 }],
        queryFn: () => fetchRuns({ limit: 100 }),
      }),
      queryClient.prefetchQuery({
        queryKey: ["approvals"],
        queryFn: () => fetchApprovals({ limit: 50 }),
      }),
    ]);
  } catch {
    // Prefetch failed, client will fetch on mount
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <OverviewContent />
    </HydrationBoundary>
  );
}
