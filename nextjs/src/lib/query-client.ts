import { QueryClient, isServer } from "@tanstack/react-query";

/**
 * Creates a QueryClient instance configured for the dashboard.
 *
 * On the server, creates a new instance per request to avoid cross-request state.
 * On the client, reuses the same instance across the app.
 */
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // With SSR, we set staleTime higher to avoid refetching immediately on client
        staleTime: 60 * 1000, // 1 minute
        refetchOnWindowFocus: true,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined = undefined;

/**
 * Get the singleton QueryClient.
 *
 * Server: Always creates a new client (avoids cross-request state leakage)
 * Browser: Reuses the same client instance
 */
export function getQueryClient() {
  if (isServer) {
    // Server: always create a new query client
    return makeQueryClient();
  }

  // Browser: reuse the same query client
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }
  return browserQueryClient;
}
