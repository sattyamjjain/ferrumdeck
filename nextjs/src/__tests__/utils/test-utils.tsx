import React, { type ReactElement } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Create a fresh QueryClient for each test
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Disable retries for tests
        retry: false,
        // Disable refetch on window focus
        refetchOnWindowFocus: false,
        // Don't throw on errors
        throwOnError: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

// All providers wrapped together
interface AllProvidersProps {
  children: React.ReactNode;
  queryClient?: QueryClient;
}

function AllProviders({ children, queryClient }: AllProvidersProps) {
  const client = queryClient ?? createTestQueryClient();

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

// Custom render function that wraps with all providers
interface CustomRenderOptions extends Omit<RenderOptions, "wrapper"> {
  queryClient?: QueryClient;
}

function renderWithProviders(
  ui: ReactElement,
  { queryClient, ...options }: CustomRenderOptions = {}
) {
  const client = queryClient ?? createTestQueryClient();

  return {
    ...render(ui, {
      wrapper: ({ children }) => (
        <AllProviders queryClient={client}>{children}</AllProviders>
      ),
      ...options,
    }),
    queryClient: client,
  };
}

// Re-export everything from testing-library
export * from "@testing-library/react";

// Override render with our custom render
export { renderWithProviders, createTestQueryClient };

// Mock data factories
export const mockRun = (overrides = {}) => ({
  id: "run_01HXYZ123456",
  workflow_id: "wf_01HXYZ123456",
  status: "running" as const,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  input: {},
  output: null,
  error: null,
  steps: [],
  ...overrides,
});

export const mockApproval = (overrides = {}) => ({
  id: "apr_01HXYZ123456",
  run_id: "run_01HXYZ123456",
  step_id: "stp_01HXYZ123456",
  status: "pending" as const,
  tool_name: "write_file",
  action_type: "tool_call",
  action_details: { path: "/tmp/test.txt" },
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 3600000).toISOString(),
  ...overrides,
});

export const mockAgent = (overrides = {}) => ({
  id: "agt_01HXYZ123456",
  name: "test-agent",
  description: "Test agent for testing",
  version: "1.0.0",
  status: "active" as const,
  created_at: new Date().toISOString(),
  ...overrides,
});

export const mockTool = (overrides = {}) => ({
  id: "tool_01HXYZ123456",
  name: "test_tool",
  description: "Test tool for testing",
  schema: { type: "object", properties: {} },
  ...overrides,
});

// Viewport helpers for responsive tests
export const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    writable: true,
    configurable: true,
    value: height,
  });
  window.dispatchEvent(new Event("resize"));
};

export const viewports = {
  mobile: { width: 375, height: 667 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
  widescreen: { width: 1920, height: 1080 },
};
