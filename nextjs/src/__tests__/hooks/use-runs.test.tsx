/**
 * Tests for useRuns hooks
 * Test IDs: HOOK-RUN-001 to HOOK-RUN-020
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRuns, useRun, useSteps, useRunWithSteps, useRunsInfinite } from "@/hooks/use-runs";
import * as runsApi from "@/lib/api/runs";
import {
  mockRunsListResponse,
  mockRunRunning,
  mockRunCompleted,
  mockSteps,
} from "@/__tests__/utils/fixtures";

// Mock the API module
jest.mock("@/lib/api/runs");

const mockedRunsApi = runsApi as jest.Mocked<typeof runsApi>;

// Create a fresh QueryClient for each test
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
    },
  });
}

function createWrapper() {
  const queryClient = createTestQueryClient();
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useRuns", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // HOOK-RUN-001: Fetches runs successfully
  it("fetches runs successfully", async () => {
    mockedRunsApi.fetchRuns.mockResolvedValue(mockRunsListResponse);

    const { result } = renderHook(() => useRuns(), {
      wrapper: createWrapper(),
    });

    // Initially loading
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockRunsListResponse);
    expect(mockedRunsApi.fetchRuns).toHaveBeenCalledTimes(1);
  });

  // HOOK-RUN-002: Passes params to fetchRuns
  it("passes params to fetchRuns", async () => {
    mockedRunsApi.fetchRuns.mockResolvedValue(mockRunsListResponse);

    const params = { status: "running" as const, limit: 10 };
    renderHook(() => useRuns(params), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockedRunsApi.fetchRuns).toHaveBeenCalledWith(params);
    });
  });

  // HOOK-RUN-003: Handles fetch error
  it("handles fetch error", async () => {
    const error = new Error("Failed to fetch");
    mockedRunsApi.fetchRuns.mockRejectedValue(error);

    const { result } = renderHook(() => useRuns(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeTruthy();
  });

  // HOOK-RUN-004: Returns loading state initially
  it("returns loading state initially", () => {
    mockedRunsApi.fetchRuns.mockResolvedValue(mockRunsListResponse);

    const { result } = renderHook(() => useRuns(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });
});

describe("useRun", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // HOOK-RUN-005: Fetches single run by ID
  it("fetches single run by ID", async () => {
    mockedRunsApi.fetchRun.mockResolvedValue(mockRunRunning);

    const { result } = renderHook(() => useRun("run_01J5EXAMPLE0002"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockRunRunning);
    expect(mockedRunsApi.fetchRun).toHaveBeenCalledWith("run_01J5EXAMPLE0002");
  });

  // HOOK-RUN-006: Disabled when runId is empty
  it("is disabled when runId is empty", () => {
    mockedRunsApi.fetchRun.mockResolvedValue(mockRunRunning);

    const { result } = renderHook(() => useRun(""), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockedRunsApi.fetchRun).not.toHaveBeenCalled();
  });

  // HOOK-RUN-007: Handles single run fetch error
  it("handles single run fetch error", async () => {
    mockedRunsApi.fetchRun.mockRejectedValue(new Error("Not found"));

    const { result } = renderHook(() => useRun("run_nonexistent"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});

describe("useSteps", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // HOOK-RUN-008: Fetches steps for a run
  it("fetches steps for a run", async () => {
    mockedRunsApi.fetchSteps.mockResolvedValue(mockSteps);

    const { result } = renderHook(() => useSteps("run_01J5EXAMPLE0002"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockSteps);
    expect(mockedRunsApi.fetchSteps).toHaveBeenCalledWith("run_01J5EXAMPLE0002");
  });

  // HOOK-RUN-009: Disabled when runId is empty
  it("is disabled when runId is empty", () => {
    const { result } = renderHook(() => useSteps(""), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockedRunsApi.fetchSteps).not.toHaveBeenCalled();
  });

  // HOOK-RUN-010: Uses runStatus for polling decision
  it("accepts runStatus parameter", async () => {
    mockedRunsApi.fetchSteps.mockResolvedValue(mockSteps);

    const { result } = renderHook(
      () => useSteps("run_01J5EXAMPLE0002", "completed"),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });
});

describe("useRunWithSteps", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // HOOK-RUN-011: Fetches both run and steps
  it("fetches both run and steps", async () => {
    mockedRunsApi.fetchRun.mockResolvedValue(mockRunRunning);
    mockedRunsApi.fetchSteps.mockResolvedValue(mockSteps);

    const { result } = renderHook(
      () => useRunWithSteps("run_01J5EXAMPLE0002"),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.run).toEqual(mockRunRunning);
    expect(result.current.steps).toEqual(mockSteps);
  });

  // HOOK-RUN-012: Returns isActive true for running runs
  it("returns isActive true for running runs", async () => {
    mockedRunsApi.fetchRun.mockResolvedValue(mockRunRunning);
    mockedRunsApi.fetchSteps.mockResolvedValue(mockSteps);

    const { result } = renderHook(
      () => useRunWithSteps("run_01J5EXAMPLE0002"),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isActive).toBe(true);
    expect(result.current.isTerminal).toBe(false);
  });

  // HOOK-RUN-013: Returns isTerminal true for completed runs
  it("returns isTerminal true for completed runs", async () => {
    mockedRunsApi.fetchRun.mockResolvedValue(mockRunCompleted);
    mockedRunsApi.fetchSteps.mockResolvedValue(mockSteps);

    const { result } = renderHook(
      () => useRunWithSteps("run_01J5EXAMPLE0003"),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isActive).toBe(false);
    expect(result.current.isTerminal).toBe(true);
  });

  // HOOK-RUN-014: Provides refetch function
  it("provides refetch function", async () => {
    mockedRunsApi.fetchRun.mockResolvedValue(mockRunRunning);
    mockedRunsApi.fetchSteps.mockResolvedValue(mockSteps);

    const { result } = renderHook(
      () => useRunWithSteps("run_01J5EXAMPLE0002"),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(typeof result.current.refetch).toBe("function");
  });

  // HOOK-RUN-015: Returns isError when run fetch fails
  it("returns isError when run fetch fails", async () => {
    mockedRunsApi.fetchRun.mockRejectedValue(new Error("Failed"));
    mockedRunsApi.fetchSteps.mockResolvedValue(mockSteps);

    const { result } = renderHook(() => useRunWithSteps("run_bad"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });

  // HOOK-RUN-016: Returns isError when steps fetch fails
  it("returns isError when steps fetch fails", async () => {
    mockedRunsApi.fetchRun.mockResolvedValue(mockRunRunning);
    mockedRunsApi.fetchSteps.mockRejectedValue(new Error("Failed"));

    const { result } = renderHook(
      () => useRunWithSteps("run_01J5EXAMPLE0002"),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});

describe("useRunsInfinite", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // HOOK-RUN-017: Fetches initial page
  it("fetches initial page", async () => {
    mockedRunsApi.fetchRuns.mockResolvedValue(mockRunsListResponse);

    const { result } = renderHook(() => useRunsInfinite(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.pages).toHaveLength(1);
    expect(result.current.data?.pages[0]).toEqual(mockRunsListResponse);
  });

  // HOOK-RUN-018: Passes params to fetchRuns
  it("passes params to fetchRuns for infinite query", async () => {
    mockedRunsApi.fetchRuns.mockResolvedValue(mockRunsListResponse);

    const params = { status: "completed" as const };
    renderHook(() => useRunsInfinite(params), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockedRunsApi.fetchRuns).toHaveBeenCalledWith(
        expect.objectContaining({ status: "completed" })
      );
    });
  });

  // HOOK-RUN-019: Has fetchNextPage function
  it("has fetchNextPage function", async () => {
    mockedRunsApi.fetchRuns.mockResolvedValue(mockRunsListResponse);

    const { result } = renderHook(() => useRunsInfinite(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(typeof result.current.fetchNextPage).toBe("function");
  });

  // HOOK-RUN-020: Reports hasNextPage correctly
  it("reports hasNextPage based on response", async () => {
    mockedRunsApi.fetchRuns.mockResolvedValue({
      ...mockRunsListResponse,
      has_more: true,
      next_cursor: "cursor_123",
    });

    const { result } = renderHook(() => useRunsInfinite(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.hasNextPage).toBe(true);
  });
});
