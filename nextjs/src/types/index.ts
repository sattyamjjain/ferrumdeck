// Re-export all types from a central location
export * from "./run";
export * from "./agent";
export * from "./tool";
export * from "./approval";
export * from "./workflow";
export * from "./audit";
export * from "./api-key";
export * from "./security";

// Common types used across the application
export interface PaginationParams {
  limit?: number;
  offset?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiResponse<T> {
  data?: T;
  error?: ApiError;
}

// Date range filter
export interface DateRange {
  start: string;
  end: string;
}

// Sort options
export interface SortOption {
  field: string;
  direction: "asc" | "desc";
}
