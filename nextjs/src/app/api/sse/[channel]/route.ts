/**
 * SSE (Server-Sent Events) Streaming Endpoint
 *
 * Provides real-time event streaming for dashboard updates.
 * Supports channels:
 * - runs:{wsId} - Workspace run events
 * - run:{runId} - Individual run step events
 * - approvals:{wsId} - Workspace approval events
 * - audit:{wsId} - Workspace audit events
 *
 * Features:
 * - Heartbeat every 30 seconds to keep connection alive
 * - Mock events for testing (will proxy to gateway in production)
 * - Proper SSE headers for streaming
 */

import { NextRequest } from "next/server";
import { getGatewayUrl } from "@/lib/api/config";

// ============================================================================
// Configuration
// ============================================================================

/** Heartbeat interval in milliseconds */
const HEARTBEAT_INTERVAL_MS = 30000;

/** Mock event interval for testing */
const MOCK_EVENT_INTERVAL_MS = 5000;

/** Maximum connection duration in milliseconds (10 minutes) */
const MAX_CONNECTION_DURATION_MS = 600000;

/** Token validation cache TTL in milliseconds (5 minutes) */
const TOKEN_VALIDATION_CACHE_TTL_MS = 300000;

// ============================================================================
// Types
// ============================================================================

interface TokenValidationResult {
  valid: boolean;
  tenantId?: string;
  error?: string;
}

interface SSEEvent {
  id: string;
  type: string;
  channel: string;
  timestamp: string;
  payload: unknown;
}

// ============================================================================
// Token Validation Cache
// ============================================================================

/**
 * Simple in-memory cache for token validation results.
 * In production, consider using Redis for distributed caching.
 */
const tokenValidationCache = new Map<string, { result: TokenValidationResult; expiresAt: number }>();

/**
 * Validate a token with the gateway API.
 *
 * SECURITY: This validates the API key/JWT with the gateway's auth endpoint.
 * The gateway returns tenant information which is used for channel ownership validation.
 */
async function validateTokenWithGateway(token: string): Promise<TokenValidationResult> {
  // Check cache first
  const cached = tokenValidationCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  try {
    const gatewayUrl = getGatewayUrl();

    // Call a lightweight endpoint that requires auth to validate the token
    // We use /v1/api-keys which lists API keys for the authenticated tenant
    // This serves double duty: validates token AND extracts tenant info
    const response = await fetch(`${gatewayUrl}/v1/api-keys?limit=1`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (response.ok) {
      // Token is valid - extract tenant ID from the response headers or infer from success
      // The gateway sets X-Tenant-ID header on successful auth
      const tenantId = response.headers.get("X-Tenant-ID") || "authenticated";

      const result: TokenValidationResult = {
        valid: true,
        tenantId,
      };

      // Cache the result
      tokenValidationCache.set(token, {
        result,
        expiresAt: Date.now() + TOKEN_VALIDATION_CACHE_TTL_MS,
      });

      return result;
    }

    if (response.status === 401) {
      return { valid: false, error: "Invalid or expired token" };
    }

    if (response.status === 403) {
      return { valid: false, error: "Insufficient permissions" };
    }

    return { valid: false, error: `Gateway returned status ${response.status}` };
  } catch (error) {
    // Gateway unavailable - in development mode, allow connection with warning
    // In production, this should fail closed
    const isDevelopment = process.env.NODE_ENV === "development";

    if (isDevelopment) {
      console.warn("[SSE] Gateway unavailable for token validation, allowing in development mode");
      return {
        valid: true,
        tenantId: "dev-tenant",
      };
    }

    return {
      valid: false,
      error: `Token validation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Validate that the authenticated tenant can access the requested channel.
 *
 * SECURITY: Channels encode resource identifiers that belong to specific tenants.
 * This function ensures users can only subscribe to channels for resources they own.
 *
 * Channel format: type:identifier
 * - runs:{projectId} - Tenant must own the project
 * - run:{runId} - Tenant must own the run's project
 * - approvals:{projectId} - Tenant must own the project
 * - audit:{projectId} - Tenant must own the project
 */
async function validateChannelAccess(
  token: string,
  tenantId: string,
  channelType: string,
  identifier: string
): Promise<{ allowed: boolean; error?: string }> {
  // For development with dev-tenant, allow all access
  if (tenantId === "dev-tenant") {
    return { allowed: true };
  }

  try {
    const gatewayUrl = getGatewayUrl();

    // Different validation based on channel type
    let validationUrl: string;

    switch (channelType) {
      case "runs":
      case "approvals":
      case "audit":
        // These use project ID as identifier - validate project ownership
        // The gateway will return 404 if the project doesn't exist or isn't owned by tenant
        validationUrl = `${gatewayUrl}/v1/runs?project_id=${encodeURIComponent(identifier)}&limit=1`;
        break;

      case "run":
        // This uses run ID as identifier - validate run ownership
        validationUrl = `${gatewayUrl}/v1/runs/${encodeURIComponent(identifier)}`;
        break;

      default:
        return { allowed: false, error: `Unknown channel type: ${channelType}` };
    }

    const response = await fetch(validationUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      return { allowed: true };
    }

    if (response.status === 404) {
      return { allowed: false, error: "Resource not found or access denied" };
    }

    if (response.status === 403) {
      return { allowed: false, error: "Access denied to this channel" };
    }

    return { allowed: false, error: `Validation returned status ${response.status}` };
  } catch (error) {
    // Gateway unavailable - in development mode, allow access with warning
    const isDevelopment = process.env.NODE_ENV === "development";

    if (isDevelopment) {
      console.warn("[SSE] Gateway unavailable for channel validation, allowing in development mode");
      return { allowed: true };
    }

    return {
      allowed: false,
      error: `Channel validation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a unique event ID
 */
function generateEventId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Format an event for SSE transmission
 */
function formatSSEMessage(event: SSEEvent): string {
  const data = JSON.stringify(event);
  return `id: ${event.id}\nevent: message\ndata: ${data}\n\n`;
}

/**
 * Format a heartbeat message
 */
function formatHeartbeat(): string {
  const event: SSEEvent = {
    id: generateEventId(),
    type: "heartbeat",
    channel: "system",
    timestamp: new Date().toISOString(),
    payload: { status: "ok" },
  };
  return `id: ${event.id}\nevent: message\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Parse and validate channel name
 */
function parseChannel(channel: string): { type: string; identifier: string } | null {
  const decoded = decodeURIComponent(channel);
  const parts = decoded.split(":");

  if (parts.length !== 2) {
    return null;
  }

  const [type, identifier] = parts;

  if (!type || !identifier) {
    return null;
  }

  const validTypes = ["runs", "run", "approvals", "audit"];
  if (!validTypes.includes(type)) {
    return null;
  }

  return { type, identifier };
}

/**
 * Generate mock events for testing based on channel type
 */
function generateMockEvent(channelType: string, channelName: string): SSEEvent | null {
  const timestamp = new Date().toISOString();
  const id = generateEventId();

  switch (channelType) {
    case "runs": {
      const eventTypes = ["run_status_changed", "run_created", "run_completed"];
      const eventType = eventTypes[Math.floor(Math.random() * eventTypes.length)];

      if (eventType === "run_status_changed") {
        return {
          id,
          type: "run_status_changed",
          channel: channelName,
          timestamp,
          payload: {
            run_id: `run_${Date.now().toString(36)}`,
            previous_status: "running",
            new_status: Math.random() > 0.5 ? "completed" : "waiting_approval",
          },
        };
      } else if (eventType === "run_created") {
        return {
          id,
          type: "run_created",
          channel: channelName,
          timestamp,
          payload: {
            run: {
              id: `run_${Date.now().toString(36)}`,
              project_id: "prj_demo",
              agent_version_id: "agv_demo",
              status: "queued",
              input: { task: "Demo task" },
              input_tokens: 0,
              output_tokens: 0,
              tool_calls: 0,
              cost_cents: 0,
              created_at: timestamp,
            },
          },
        };
      } else {
        return {
          id,
          type: "run_completed",
          channel: channelName,
          timestamp,
          payload: {
            run_id: `run_${Date.now().toString(36)}`,
            status: "completed",
            usage: {
              input_tokens: Math.floor(Math.random() * 1000),
              output_tokens: Math.floor(Math.random() * 500),
              tool_calls: Math.floor(Math.random() * 5),
              cost_cents: Math.floor(Math.random() * 10),
            },
          },
        };
      }
    }

    case "run": {
      const eventTypes = ["step_created", "step_status_changed", "step_completed"];
      const eventType = eventTypes[Math.floor(Math.random() * eventTypes.length)];
      const runId = channelName.split(":")[1] || "run_demo";

      if (eventType === "step_created") {
        return {
          id,
          type: "step_created",
          channel: channelName,
          timestamp,
          payload: {
            step: {
              id: `stp_${Date.now().toString(36)}`,
              run_id: runId,
              step_number: Math.floor(Math.random() * 10) + 1,
              step_type: Math.random() > 0.5 ? "llm" : "tool",
              status: "pending",
              input: {},
              created_at: timestamp,
            },
          },
        };
      } else if (eventType === "step_status_changed") {
        return {
          id,
          type: "step_status_changed",
          channel: channelName,
          timestamp,
          payload: {
            step_id: `stp_${Date.now().toString(36)}`,
            run_id: runId,
            previous_status: "pending",
            new_status: "running",
          },
        };
      } else {
        return {
          id,
          type: "step_completed",
          channel: channelName,
          timestamp,
          payload: {
            step_id: `stp_${Date.now().toString(36)}`,
            run_id: runId,
            status: "completed",
            input_tokens: Math.floor(Math.random() * 100),
            output_tokens: Math.floor(Math.random() * 200),
          },
        };
      }
    }

    case "approvals": {
      const eventTypes = ["approval_created", "approval_resolved"];
      const eventType = eventTypes[Math.floor(Math.random() * eventTypes.length)];

      if (eventType === "approval_created") {
        return {
          id,
          type: "approval_created",
          channel: channelName,
          timestamp,
          payload: {
            approval: {
              id: `apr_${Date.now().toString(36)}`,
              run_id: `run_${Date.now().toString(36)}`,
              step_id: `stp_${Date.now().toString(36)}`,
              policy_decision_id: `pld_${Date.now().toString(36)}`,
              action_type: "tool_call",
              action_details: { tool: "file_write", path: "/etc/config" },
              tool_name: "file_write",
              reason: "Write access to sensitive path requires approval",
              status: "pending",
              risk_level: "high",
              created_at: timestamp,
              expires_at: new Date(Date.now() + 3600000).toISOString(),
            },
          },
        };
      } else {
        return {
          id,
          type: "approval_resolved",
          channel: channelName,
          timestamp,
          payload: {
            approval_id: `apr_${Date.now().toString(36)}`,
            status: Math.random() > 0.3 ? "approved" : "rejected",
            resolved_by: "user_admin",
            resolved_at: timestamp,
            resolution_note: "Action reviewed and approved",
          },
        };
      }
    }

    case "audit": {
      return {
        id,
        type: "audit_event_created",
        channel: channelName,
        timestamp,
        payload: {
          id: `aev_${Date.now().toString(36)}`,
          event_type: "run.status_changed",
          actor_type: "system",
          actor_id: "worker_1",
          resource_type: "run",
          resource_id: `run_${Date.now().toString(36)}`,
          action: "status_change",
          metadata: {
            from_status: "running",
            to_status: "completed",
          },
          created_at: timestamp,
        },
      };
    }

    default:
      return null;
  }
}

// ============================================================================
// Route Handler
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ channel: string }> }
): Promise<Response> {
  // SECURITY: Validate authentication before allowing SSE subscription
  // Check for Authorization header or token query parameter
  const authHeader = request.headers.get("Authorization");
  const tokenParam = request.nextUrl.searchParams.get("token");
  const token = authHeader?.replace("Bearer ", "") || tokenParam;

  if (!token) {
    return new Response(
      JSON.stringify({ error: "Authentication required" }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // SECURITY: Validate token with gateway
  // This verifies the API key/JWT is valid and extracts tenant information
  const tokenValidation = await validateTokenWithGateway(token);

  if (!tokenValidation.valid) {
    return new Response(
      JSON.stringify({ error: tokenValidation.error || "Invalid authentication token" }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const { channel } = await params;

  // Validate channel format first
  const parsedChannel = parseChannel(channel);
  if (!parsedChannel) {
    return new Response(
      JSON.stringify({ error: "Invalid channel format. Expected: type:identifier" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // SECURITY: Validate channel ownership
  // Ensures the authenticated tenant can only subscribe to channels for resources they own
  const channelAccess = await validateChannelAccess(
    token,
    tokenValidation.tenantId || "",
    parsedChannel.type,
    parsedChannel.identifier
  );

  if (!channelAccess.allowed) {
    return new Response(
      JSON.stringify({ error: channelAccess.error || "Access denied to this channel" }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const channelName = decodeURIComponent(channel);

  // Create a readable stream for SSE
  const encoder = new TextEncoder();
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let mockEventInterval: ReturnType<typeof setInterval> | null = null;
  let connectionTimeout: ReturnType<typeof setTimeout> | null = null;
  let isStreamClosed = false;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event
      const connectEvent: SSEEvent = {
        id: generateEventId(),
        type: "connected",
        channel: channelName,
        timestamp: new Date().toISOString(),
        payload: {
          channel: channelName,
          channelType: parsedChannel.type,
          identifier: parsedChannel.identifier,
        },
      };

      try {
        controller.enqueue(encoder.encode(formatSSEMessage(connectEvent)));
      } catch {
        isStreamClosed = true;
        return;
      }

      // Set up heartbeat
      heartbeatInterval = setInterval(() => {
        if (isStreamClosed) return;
        try {
          controller.enqueue(encoder.encode(formatHeartbeat()));
        } catch {
          isStreamClosed = true;
          cleanup();
        }
      }, HEARTBEAT_INTERVAL_MS);

      // Set up mock events for testing
      // In production, this would be replaced with a connection to the gateway
      mockEventInterval = setInterval(() => {
        if (isStreamClosed) return;

        // Only send mock events occasionally (10% chance)
        if (Math.random() > 0.1) return;

        const mockEvent = generateMockEvent(parsedChannel.type, channelName);
        if (mockEvent) {
          try {
            controller.enqueue(encoder.encode(formatSSEMessage(mockEvent)));
          } catch {
            isStreamClosed = true;
            cleanup();
          }
        }
      }, MOCK_EVENT_INTERVAL_MS);

      // Set up max connection duration timeout
      connectionTimeout = setTimeout(() => {
        isStreamClosed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      }, MAX_CONNECTION_DURATION_MS);

      function cleanup() {
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        if (mockEventInterval) {
          clearInterval(mockEventInterval);
          mockEventInterval = null;
        }
        if (connectionTimeout) {
          clearTimeout(connectionTimeout);
          connectionTimeout = null;
        }
      }

      // Handle abort signal
      request.signal.addEventListener("abort", () => {
        isStreamClosed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },

    cancel() {
      isStreamClosed = true;
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      if (mockEventInterval) {
        clearInterval(mockEventInterval);
      }
      if (connectionTimeout) {
        clearTimeout(connectionTimeout);
      }
    },
  });

  // Return SSE response with proper headers
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    },
  });
}

// Disable body parsing for this route
export const dynamic = "force-dynamic";
