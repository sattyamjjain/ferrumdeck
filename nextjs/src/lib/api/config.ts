// Runtime configuration - these functions ensure env vars are read at runtime, not build time
export function getGatewayUrl(): string {
  return process.env.GATEWAY_URL || "http://localhost:8080";
}

export function getApiKey(): string {
  return process.env.FD_API_KEY || "fd_dev_key_abc123";
}

export function getDefaultProjectId(): string {
  return process.env.FD_PROJECT_ID || "prj_01JFVX0000000000000000001";
}

export function getAuthHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    "Content-Type": "application/json",
  };
}

// Check if we should use mock data (when gateway is unavailable)
export function useMockData(): boolean {
  return process.env.MOCK_API === "true" || process.env.NODE_ENV === "development";
}

// Helper to fetch with fallback to mock data
export async function fetchWithMockFallback<T>(
  url: string,
  options: RequestInit,
  mockData: T
): Promise<{ data: T; status: number; isMock: boolean }> {
  try {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(3000), // 3 second timeout
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    return { data, status: response.status, isMock: false };
  } catch {
    // Gateway unavailable, return mock data
    return { data: mockData, status: 200, isMock: true };
  }
}
