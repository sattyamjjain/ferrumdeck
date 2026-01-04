"use client";

import { useRef, useMemo, useCallback } from "react";

interface LiveRegionProps {
  /**
   * Message to announce to screen readers.
   * When this changes, the new message is announced.
   */
  message: string;

  /**
   * Politeness level for the announcement:
   * - "polite": Waits for the user to pause before announcing (default)
   * - "assertive": Interrupts the user immediately
   */
  politeness?: "polite" | "assertive";
}

/**
 * ARIA Live Region component for announcing dynamic content changes.
 *
 * Use this to announce updates from polling, real-time data, or other
 * asynchronous content changes to screen reader users.
 *
 * @example
 * ```tsx
 * <LiveRegion
 *   message={`${newRunCount} new runs available`}
 *   politeness="polite"
 * />
 * ```
 */
export function LiveRegion({
  message,
  politeness = "polite",
}: LiveRegionProps) {
  return (
    <div
      role="status"
      aria-live={politeness}
      aria-atomic="true"
      className="sr-only"
    >
      {message}
    </div>
  );
}

/**
 * Hook to generate status messages for data polling.
 * Returns a function to get the current announcement message.
 *
 * @example
 * ```tsx
 * const getAnnouncement = usePollingAnnouncement({
 *   label: "runs",
 *   count: runs.length,
 *   newCount: newRunsCount,
 *   isLoading,
 * });
 *
 * return <LiveRegion message={getAnnouncement()} />;
 * ```
 */
export function usePollingAnnouncement({
  label,
  count,
  newCount = 0,
  isLoading,
  interval = 30000, // Only announce every 30s to avoid spam
}: {
  label: string;
  count: number;
  newCount?: number;
  isLoading: boolean;
  interval?: number;
}): () => string {
  const lastAnnouncementRef = useRef(0);
  const previousCountRef = useRef(count);

  const getAnnouncement = useCallback(() => {
    if (isLoading) return "";

    const now = Date.now();
    const timeSinceLastAnnouncement = now - lastAnnouncementRef.current;

    // Only announce if enough time has passed
    if (timeSinceLastAnnouncement < interval) return "";

    // Announce new items
    if (newCount > 0) {
      lastAnnouncementRef.current = now;
      previousCountRef.current = count;
      return `${newCount} new ${label} available. Total: ${count}.`;
    }

    // Announce significant count changes (more than 5)
    if (Math.abs(count - previousCountRef.current) >= 5) {
      lastAnnouncementRef.current = now;
      previousCountRef.current = count;
      return `${label} updated. Now showing ${count} items.`;
    }

    return "";
  }, [label, count, newCount, isLoading, interval]);

  return getAnnouncement;
}

/**
 * Simpler hook that returns a memoized announcement string.
 * Use when you just need a simple announcement without timing logic.
 */
export function useSimpleAnnouncement({
  label,
  count,
  isLoading,
}: {
  label: string;
  count: number;
  isLoading: boolean;
}): string {
  return useMemo(() => {
    if (isLoading) return "Loading...";
    return `Showing ${count} ${label}`;
  }, [label, count, isLoading]);
}
