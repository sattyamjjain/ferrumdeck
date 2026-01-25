"use client";

import { useSyncExternalStore } from "react";

/**
 * Hook to detect client-side mounting for hydration-safe rendering.
 *
 * Use this hook when rendering components that have different server/client
 * output (e.g., Radix UI components that need client-side JavaScript).
 *
 * @returns `true` after the component has mounted on the client, `false` during SSR
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const mounted = useIsMounted();
 *
 *   if (!mounted) {
 *     return <Skeleton />;
 *   }
 *
 *   return <RadixDialog>...</RadixDialog>;
 * }
 * ```
 */

// Stable references for useSyncExternalStore
const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

export function useIsMounted(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
