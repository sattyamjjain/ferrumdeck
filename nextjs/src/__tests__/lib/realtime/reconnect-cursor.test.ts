/**
 * @jest-environment node
 */
import {
    buildChannelUrl,
    getSubscriptionManager,
    SubscriptionManager,
} from "@/lib/realtime/subscription-manager";
import {
    isPolicyResponseRecordedEvent,
    isRunChannelEvent,
    isStreamGapEvent,
    type SSEEvent,
} from "@/lib/realtime/channels";

/**
 * The reconnect contract (issue #5).
 *
 * "An SSE stream that drops events on reconnect is worse than polling for an
 * audit surface." The cursor is the only thing standing between an
 * application-level reconnect and a silently dropped event, and it is invisible
 * in every rendered output — so it is asserted directly rather than inferred
 * from a component test.
 */
describe("reconnect carries a resume cursor", () => {
    it("omits the cursor on a first connection", () => {
        // No cursor means "watch from now". Sending `last_event_id=null` or an
        // empty string would ask the gateway to replay from the beginning of
        // its buffer on every fresh page load.
        expect(buildChannelUrl("/api/sse", "run:run_abc", null)).toBe(
            "/api/sse/run%3Arun_abc",
        );
    });

    it("appends the cursor on a reconnect", () => {
        // This is the whole fix. The manager reconnects by closing the
        // EventSource and constructing a new one; a fresh EventSource sends no
        // Last-Event-ID header and the API gives no way to add one, so without
        // this parameter the gap is lost every single time.
        expect(buildChannelUrl("/api/sse", "run:run_abc", "42")).toBe(
            "/api/sse/run%3Arun_abc?last_event_id=42",
        );
    });

    it("encodes a cursor that would otherwise break the query string", () => {
        expect(buildChannelUrl("/api/sse", "run:r", "a b&c=1")).toBe(
            "/api/sse/run%3Ar?last_event_id=a%20b%26c%3D1",
        );
    });
});

describe("run-channel event guards admit what the union declares", () => {
    const event = (type: string): SSEEvent =>
        ({
            id: "1",
            type,
            channel: "run:r1",
            timestamp: "2026-08-24T00:00:00Z",
            payload: {},
        }) as unknown as SSEEvent;

    it("admits policy.response.recorded", () => {
        // Regression guard. `isRunChannelEvent` tested only the three step_*
        // types while PolicyResponseRecordedEvent was already in the
        // RunChannelEvent union, so the guard returned false for a variant it
        // was supposed to admit. Harmless while the channel carried heartbeats
        // only; the moment the gateway started pushing, any consumer narrowing
        // through this guard would have discarded every policy event.
        expect(isRunChannelEvent(event("policy.response.recorded"))).toBe(true);
        expect(
            isPolicyResponseRecordedEvent(event("policy.response.recorded")),
        ).toBe(true);
    });

    it("still admits the step events", () => {
        expect(isRunChannelEvent(event("step_created"))).toBe(true);
        expect(isRunChannelEvent(event("step_status_changed"))).toBe(true);
        expect(isRunChannelEvent(event("step_completed"))).toBe(true);
    });

    it("admits stream gap notices, so an incomplete stream cannot be narrowed away", () => {
        for (const t of ["stream.gap", "stream.degraded", "stream.error"]) {
            expect(isStreamGapEvent(event(t))).toBe(true);
            expect(isRunChannelEvent(event(t))).toBe(true);
        }
    });

    it("rejects events from other channels", () => {
        expect(isRunChannelEvent(event("approval_created"))).toBe(false);
        expect(isPolicyResponseRecordedEvent(event("step_created"))).toBe(false);
        expect(isStreamGapEvent(event("step_created"))).toBe(false);
    });
});

describe("the manager exists and is a singleton", () => {
    it("returns the same instance", () => {
        expect(getSubscriptionManager()).toBeInstanceOf(SubscriptionManager);
        expect(getSubscriptionManager()).toBe(getSubscriptionManager());
    });
});
