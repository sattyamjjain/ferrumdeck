/**
 * Mock API utilities for testing
 *
 * Provides helpers to mock fetch calls and API responses
 */

import * as fixtures from "./fixtures";

type MockResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

/**
 * Create a mock fetch response
 */
export function createMockResponse(
  data: unknown,
  { ok = true, status = 200 }: { ok?: boolean; status?: number } = {}
): MockResponse {
  return {
    ok,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

/**
 * Create an error response
 */
export function createErrorResponse(
  message: string,
  status = 500
): MockResponse {
  return createMockResponse(
    { error: message },
    { ok: false, status }
  );
}

/**
 * Default mock handlers for common API endpoints
 */
export const defaultMockHandlers: Record<string, () => MockResponse> = {
  // Runs
  "/api/v1/runs": () => createMockResponse(fixtures.mockRunsListResponse),
  "/api/v1/runs/run_01J5EXAMPLE0001": () =>
    createMockResponse(fixtures.mockRunCreated),
  "/api/v1/runs/run_01J5EXAMPLE0002": () =>
    createMockResponse(fixtures.mockRunRunning),
  "/api/v1/runs/run_01J5EXAMPLE0003": () =>
    createMockResponse(fixtures.mockRunCompleted),

  // Steps
  "/api/v1/runs/run_01J5EXAMPLE0002/steps": () =>
    createMockResponse({ steps: fixtures.mockSteps }),

  // Approvals
  "/api/v1/approvals": () =>
    createMockResponse(fixtures.mockApprovalsListResponse),
  "/api/v1/approvals/apr_01J5EXAMPLE0001": () =>
    createMockResponse(fixtures.mockApprovalPending),

  // Agents
  "/api/v1/agents": () => createMockResponse(fixtures.mockAgentsListResponse),
  "/api/v1/agents/agt_01J5EXAMPLE0001": () =>
    createMockResponse(fixtures.mockAgent),

  // Tools
  "/api/v1/tools": () =>
    createMockResponse({
      tools: fixtures.mockTools,
      total: fixtures.mockTools.length,
      offset: 0,
      limit: 20,
    }),

  // Health
  "/api/v1/health": () =>
    createMockResponse({ status: "healthy", version: "1.0.0" }),
};

/**
 * Create a mock fetch function with custom handlers
 */
export function createMockFetch(
  customHandlers: Record<string, () => MockResponse> = {}
) {
  const handlers = { ...defaultMockHandlers, ...customHandlers };

  return jest.fn((url: string, _options?: RequestInit) => {
    // Extract path from URL
    const path = url.startsWith("http")
      ? new URL(url).pathname
      : url.split("?")[0];

    // Find matching handler
    const handler = handlers[path];

    if (handler) {
      return Promise.resolve(handler());
    }

    // Default 404 response
    return Promise.resolve(
      createErrorResponse(`No mock handler for ${path}`, 404)
    );
  });
}

/**
 * Setup global fetch mock with default handlers
 */
export function setupFetchMock(
  customHandlers?: Record<string, () => MockResponse>
) {
  const mockFetch = createMockFetch(customHandlers);
  global.fetch = mockFetch as unknown as typeof fetch;
  return mockFetch;
}

/**
 * Restore original fetch
 */
export function restoreFetch() {
  // @ts-expect-error - Restoring fetch
  delete global.fetch;
}

/**
 * Wait for all pending promises to resolve
 */
export function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Wait for a specific amount of time
 */
export function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
