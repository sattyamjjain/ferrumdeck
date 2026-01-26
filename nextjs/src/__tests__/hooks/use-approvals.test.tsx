/**
 * Tests for useApprovals hooks
 * Test IDs: HOOK-APR-001 to HOOK-APR-015
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useApprovals, useApproveAction, useRejectAction } from "@/hooks/use-approvals";
import * as approvalsApi from "@/lib/api/approvals";
import {
  mockApprovalsListResponse,
  mockApprovalApproved,
  mockApprovalRejected,
} from "@/__tests__/utils/fixtures";

// Mock the API module
jest.mock("@/lib/api/approvals");

// Mock sonner toast
jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

const mockedApprovalsApi = approvalsApi as jest.Mocked<typeof approvalsApi>;

// Create a fresh QueryClient for each test
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
      mutations: {
        retry: false,
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

describe("useApprovals", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // HOOK-APR-001: Fetches approvals successfully
  it("fetches approvals successfully", async () => {
    mockedApprovalsApi.fetchApprovals.mockResolvedValue(mockApprovalsListResponse);

    const { result } = renderHook(() => useApprovals(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockApprovalsListResponse);
  });

  // HOOK-APR-002: Calls fetchApprovals with limit
  it("calls fetchApprovals with limit parameter", async () => {
    mockedApprovalsApi.fetchApprovals.mockResolvedValue(mockApprovalsListResponse);

    renderHook(() => useApprovals(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockedApprovalsApi.fetchApprovals).toHaveBeenCalledWith({ limit: 50 });
    });
  });

  // HOOK-APR-003: Handles fetch error
  it("handles fetch error", async () => {
    mockedApprovalsApi.fetchApprovals.mockRejectedValue(new Error("Failed"));

    const { result } = renderHook(() => useApprovals(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });

  // HOOK-APR-004: Returns loading state initially
  it("returns loading state initially", () => {
    mockedApprovalsApi.fetchApprovals.mockResolvedValue(mockApprovalsListResponse);

    const { result } = renderHook(() => useApprovals(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });
});

describe("useApproveAction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // HOOK-APR-005: Returns mutation object
  it("returns mutation object", () => {
    const { result } = renderHook(() => useApproveAction(), {
      wrapper: createWrapper(),
    });

    expect(result.current.mutate).toBeDefined();
    expect(typeof result.current.mutate).toBe("function");
    expect(result.current.isPending).toBe(false);
  });

  // HOOK-APR-006: Calls approveRequest with correct params
  it("calls approveRequest with correct params", async () => {
    mockedApprovalsApi.approveRequest.mockResolvedValue(mockApprovalApproved);

    const { result } = renderHook(() => useApproveAction(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ approvalId: "apr_123", note: "LGTM" });
    });

    await waitFor(() => {
      expect(mockedApprovalsApi.approveRequest).toHaveBeenCalledWith("apr_123", "LGTM");
    });
  });

  // HOOK-APR-007: Sets isPending during mutation
  it("sets isPending during mutation", async () => {
    let resolvePromise: () => void;
    const pendingPromise = new Promise<typeof mockApprovalApproved>((resolve) => {
      resolvePromise = () => resolve(mockApprovalApproved);
    });
    mockedApprovalsApi.approveRequest.mockReturnValue(pendingPromise);

    const { result } = renderHook(() => useApproveAction(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ approvalId: "apr_123" });
    });

    await waitFor(() => {
      expect(result.current.isPending).toBe(true);
    });

    await act(async () => {
      resolvePromise!();
    });

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });
  });

  // HOOK-APR-008: Handles approve error
  it("handles approve error", async () => {
    const error = new Error("Approval failed");
    mockedApprovalsApi.approveRequest.mockRejectedValue(error);

    const { result } = renderHook(() => useApproveAction(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ approvalId: "apr_123" });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });

  // HOOK-APR-009: Calls without note when not provided
  it("calls approveRequest without note when not provided", async () => {
    mockedApprovalsApi.approveRequest.mockResolvedValue(mockApprovalApproved);

    const { result } = renderHook(() => useApproveAction(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ approvalId: "apr_123" });
    });

    await waitFor(() => {
      expect(mockedApprovalsApi.approveRequest).toHaveBeenCalledWith("apr_123", undefined);
    });
  });
});

describe("useRejectAction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // HOOK-APR-010: Returns mutation object
  it("returns mutation object", () => {
    const { result } = renderHook(() => useRejectAction(), {
      wrapper: createWrapper(),
    });

    expect(result.current.mutate).toBeDefined();
    expect(typeof result.current.mutate).toBe("function");
    expect(result.current.isPending).toBe(false);
  });

  // HOOK-APR-011: Calls rejectRequest with correct params
  it("calls rejectRequest with correct params", async () => {
    mockedApprovalsApi.rejectRequest.mockResolvedValue(mockApprovalRejected);

    const { result } = renderHook(() => useRejectAction(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ approvalId: "apr_456", note: "Not safe" });
    });

    await waitFor(() => {
      expect(mockedApprovalsApi.rejectRequest).toHaveBeenCalledWith("apr_456", "Not safe");
    });
  });

  // HOOK-APR-012: Sets isPending during mutation
  it("sets isPending during mutation", async () => {
    let resolvePromise: () => void;
    const pendingPromise = new Promise<typeof mockApprovalRejected>((resolve) => {
      resolvePromise = () => resolve(mockApprovalRejected);
    });
    mockedApprovalsApi.rejectRequest.mockReturnValue(pendingPromise);

    const { result } = renderHook(() => useRejectAction(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate({ approvalId: "apr_456" });
    });

    await waitFor(() => {
      expect(result.current.isPending).toBe(true);
    });

    await act(async () => {
      resolvePromise!();
    });

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });
  });

  // HOOK-APR-013: Handles reject error
  it("handles reject error", async () => {
    mockedApprovalsApi.rejectRequest.mockRejectedValue(new Error("Reject failed"));

    const { result } = renderHook(() => useRejectAction(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ approvalId: "apr_456" });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });

  // HOOK-APR-014: Calls without note when not provided
  it("calls rejectRequest without note when not provided", async () => {
    mockedApprovalsApi.rejectRequest.mockResolvedValue(mockApprovalRejected);

    const { result } = renderHook(() => useRejectAction(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ approvalId: "apr_456" });
    });

    await waitFor(() => {
      expect(mockedApprovalsApi.rejectRequest).toHaveBeenCalledWith("apr_456", undefined);
    });
  });

  // HOOK-APR-015: Returns isSuccess after successful mutation
  it("returns isSuccess after successful mutation", async () => {
    mockedApprovalsApi.rejectRequest.mockResolvedValue(mockApprovalRejected);

    const { result } = renderHook(() => useRejectAction(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ approvalId: "apr_456" });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });
});
