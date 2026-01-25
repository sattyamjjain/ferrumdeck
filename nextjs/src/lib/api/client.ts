/**
 * API client utilities for making requests to the backend.
 */

// =============================================================================
// Constants
// =============================================================================

/** Base URL for API requests (BFF proxy) */
const API_BASE = "/api";

/** Default headers for JSON requests */
const JSON_HEADERS: HeadersInit = {
  "Content-Type": "application/json",
};

// =============================================================================
// Error Types
// =============================================================================

/** Structured API error with status code and response data */
export class APIError extends Error {
  readonly name = "APIError";

  constructor(
    public readonly status: number,
    public readonly data: unknown
  ) {
    super(`API Error: ${status}`);
  }

  /** Check if error is a client error (4xx) */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }

  /** Check if error is a server error (5xx) */
  get isServerError(): boolean {
    return this.status >= 500;
  }

  /** Check if error is unauthorized (401) */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** Check if error is forbidden (403) */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  /** Check if error is not found (404) */
  get isNotFound(): boolean {
    return this.status === 404;
  }
}

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Parse error response body safely.
 * Returns null if body cannot be parsed as JSON.
 */
async function parseErrorBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Make an API request and return the JSON response.
 *
 * @param endpoint - API endpoint path (will be prefixed with /api)
 * @param options - Fetch request options
 * @returns Parsed JSON response
 * @throws {APIError} If response is not ok
 *
 * @example
 * const user = await fetchAPI<User>('/v1/users/123');
 * const runs = await fetchAPI<Run[]>('/v1/runs?limit=10');
 */
export async function fetchAPI<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      ...JSON_HEADERS,
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new APIError(response.status, await parseErrorBody(response));
  }

  return response.json();
}

/**
 * Make an API request that returns no content.
 * Use for DELETE requests or other operations with 204 response.
 *
 * @param endpoint - API endpoint path (will be prefixed with /api)
 * @param options - Fetch request options
 * @throws {APIError} If response is not ok
 *
 * @example
 * await fetchAPINoContent('/v1/runs/123', { method: 'DELETE' });
 */
export async function fetchAPINoContent(
  endpoint: string,
  options: RequestInit = {}
): Promise<void> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      ...JSON_HEADERS,
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new APIError(response.status, await parseErrorBody(response));
  }
}
