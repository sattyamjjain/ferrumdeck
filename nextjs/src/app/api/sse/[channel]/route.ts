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
 * - Gateway -> BFF push (issue #5): when the gateway's own SSE surface
 *   (`GET /v1/events/{channel}`) is reachable, this route PROXIES it, so the
 *   channel carries real governance events rather than heartbeats only.
 * - Reconnect replay: `Last-Event-ID` (header) and `?last_event_id=` (query)
 *   are both forwarded upstream. A fresh `EventSource` sends no header -- the
 *   browser only resends one when IT reconnects the same object -- so the
 *   query parameter is the path that matters for application-level reconnect,
 *   and dropping it would silently lose every event in the gap.
 * - Heartbeat every 30 seconds when serving locally (the proxied stream carries
 *   the gateway's own keep-alive).
 * - Synthetic events (wire shapes) only when FERRUMDECK_SSE_MOCK_EVENTS=1/true
 *   (OFF by default in every environment).
 * - Proper SSE headers for streaming
 *
 * When the gateway is unreachable the route still opens a stream, but it emits
 * a `stream.degraded` event saying so. That is the difference that matters on
 * an audit surface: a silent connected stream and a connected stream with
 * nothing behind it look identical, and only one of them means "nothing has
 * happened".
 */

import { NextRequest } from "next/server";
import { getGatewayUrl } from "@/lib/api/config";
import {
  sseMockEventsEnabled,
  startMockEventStream,
  generateEventId,
  type SSEEvent,
} from "@/lib/realtime/mock-events";

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


// ============================================================================
// Gateway upstream (issue #5)
// ============================================================================

/**
 * Open the gateway's SSE stream for this channel, forwarding the resume cursor.
 *
 * Returns `null` when the gateway cannot be reached or refuses the channel; the
 * caller then serves a local stream that SAYS it is degraded rather than one
 * that is quietly empty.
 */
async function openGatewayStream(
  channelName: string,
  token: string,
  lastEventId: string | null,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array> | null> {
  const url = new URL(
    `${getGatewayUrl()}/v1/events/${encodeURIComponent(channelName)}`,
  );
  if (lastEventId) {
    // Forwarded as a query parameter as well as a header: a rebuilt
    // EventSource sends no header, and the EventSource API gives no way to add
    // one, so this is the only cursor most reconnects carry.
    url.searchParams.set("last_event_id", lastEventId);
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "text/event-stream",
  };
  if (lastEventId) headers["Last-Event-ID"] = lastEventId;

  try {
    const upstream = await fetch(url, { headers, signal });
    if (!upstream.ok || !upstream.body) {
      console.warn(
        JSON.stringify({
          msg: "sse_upstream_unavailable",
          channel: channelName,
          status: upstream.status,
        }),
      );
      return null;
    }
    return upstream.body;
  } catch (error) {
    console.warn(
      JSON.stringify({
        msg: "sse_upstream_unreachable",
        channel: channelName,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
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

  // --- gateway -> BFF push (issue #5) -------------------------------------
  // Accept the resume cursor from either place. The browser sends the header
  // when it reconnects an EventSource itself; the dashboard's subscription
  // manager rebuilds the EventSource, which sends no header, so it appends the
  // query parameter instead.
  const lastEventId =
    request.headers.get("Last-Event-ID") ??
    request.nextUrl.searchParams.get("last_event_id");

  const upstream = await openGatewayStream(
    channelName,
    token,
    lastEventId,
    request.signal,
  );

  if (upstream) {
    // Proxy the gateway's stream verbatim. Re-framing it here would mean
    // re-emitting `id:` lines, and an id this layer invented would break the
    // client's resume cursor — the gateway's ids are the ones replay is keyed
    // on, so they pass through untouched.
    console.log(
      JSON.stringify({
        msg: "sse_stream_open",
        channel: channelName,
        source: "gateway",
        resumed_from: lastEventId ?? null,
      }),
    );
    return new Response(upstream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

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
        // The gateway could not be reached, so this stream carries no
        // governance events. Say it on the wire. A connected-but-silent stream
        // and a connected stream with nothing behind it are indistinguishable
        // to a consumer, and only one of them means "nothing has happened" --
        // exactly the confusion that made the heartbeats-only channel worse
        // than useless for an audit surface.
        controller.enqueue(
          encoder.encode(
            formatSSEMessage({
              id: generateEventId(),
              type: "stream.degraded",
              channel: channelName,
              timestamp: new Date().toISOString(),
              payload: {
                reason: "gateway_unreachable",
                message:
                  "The gateway's realtime endpoint could not be reached, so this stream carries heartbeats only. Silence here does NOT mean no policy decisions were recorded; read them from the run endpoint instead.",
                issue: "https://github.com/sattyamjjain/ferrumdeck/issues/5",
              },
            }),
          ),
        );
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

      // Synthetic SSE events for wire-shape development only — OFF by default in
      // every environment; gated by FERRUMDECK_SSE_MOCK_EVENTS (see ROADMAP #5).
      // When off, startMockEventStream returns null and no timer is created, so
      // no fabricated enforcement verdict can ever reach an operator's console.
      const mockEventsOn = sseMockEventsEnabled();
      console.log(
        JSON.stringify(
          mockEventsOn
            ? {
                msg: "sse_stream_open",
                channel: channelName,
                sse_mock_events: "on",
                note: "SYNTHETIC events \u2014 not gateway data",
              }
            : {
                msg: "sse_stream_open",
                channel: channelName,
                sse_mock_events: "off",
              },
        ),
      );
      mockEventInterval = startMockEventStream({
        channelType: parsedChannel.type,
        channelName,
        intervalMs: MOCK_EVENT_INTERVAL_MS,
        onEvent: (mockEvent) => {
          if (isStreamClosed) return;
          try {
            controller.enqueue(encoder.encode(formatSSEMessage(mockEvent)));
          } catch {
            isStreamClosed = true;
            cleanup();
          }
        },
      });

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
