// Runtime configuration - these functions ensure env vars are read at runtime, not build time
export function getGatewayUrl(): string {
  return process.env.GATEWAY_URL || "http://localhost:8080";
}

export function getApiKey(): string {
  const apiKey = process.env.FD_API_KEY;
  if (!apiKey) {
    throw new Error(
      "FD_API_KEY environment variable is required. " +
      "Set it in your .env.local or environment."
    );
  }
  return apiKey;
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
