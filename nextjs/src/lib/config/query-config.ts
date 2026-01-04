/**
 * Centralized configuration for TanStack Query polling intervals.
 * This ensures consistent polling behavior across the application.
 */

/** Polling intervals in milliseconds */
export const POLLING_INTERVALS = {
  /** Fast polling for actively running items (2 seconds) */
  ACTIVE: 2000,

  /** Medium polling for items that might change (5 seconds) */
  MEDIUM: 5000,

  /** Slow polling for items unlikely to change (10 seconds) */
  SLOW: 10000,

  /** Minimal polling for background refresh (30 seconds) */
  BACKGROUND: 30000,
} as const;

/** Stale time configuration in milliseconds */
export const STALE_TIMES = {
  /** Immediate staleness for real-time data */
  IMMEDIATE: 0,

  /** Short staleness for frequently changing data (1 second) */
  SHORT: 1000,

  /** Medium staleness for moderately changing data (30 seconds) */
  MEDIUM: 30000,

  /** Long staleness for rarely changing data (5 minutes) */
  LONG: 300000,
} as const;

/** Default query retry configuration */
export const RETRY_CONFIG = {
  /** Number of retry attempts */
  retries: 3,

  /** Exponential backoff delay calculator */
  retryDelay: (attemptIndex: number) =>
    Math.min(1000 * 2 ** attemptIndex, 30000),
} as const;

export type PollingInterval = typeof POLLING_INTERVALS[keyof typeof POLLING_INTERVALS];
export type StaleTime = typeof STALE_TIMES[keyof typeof STALE_TIMES];
