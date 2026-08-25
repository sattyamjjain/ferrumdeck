/**
 * The push actually reaches the cached run (#47).
 *
 * The issue's Done criterion is "the dashboard updates from the push rather
 * than a poll". That is invisible in rendered output — a field can look right
 * because the poll happened to land — so it is asserted against the query cache
 * directly, with no poll in play at all.
 */
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useRunChannel } from "@/hooks/use-run-channel";
import type { SSEEvent } from "@/lib/realtime/channels";
import type { Run } from "@/types/run";

let emit: ((e: SSEEvent) => void) | undefined;

jest.mock("@/lib/realtime/use-subscription", () => ({
    useSubscription: (_channel: unknown, onMessage: (e: SSEEvent) => void) => {
        emit = onMessage;
        return {
            status: "connected",
            reconnect: jest.fn(),
            disconnect: jest.fn(),
            isConnected: true,
            isStale: false,
        };
    },
}));

const RUN_ID = "run_1";

function setup(seed: Partial<Run> = {}) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["run", RUN_ID], {
        id: RUN_ID,
        status: "running",
        ...seed,
    } as Run);

    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const hook = renderHook(() => useRunChannel(RUN_ID), { wrapper });
    return {
        queryClient,
        hook,
        run: () => queryClient.getQueryData<Run>(["run", RUN_ID])!,
        announcement: () => hook.result.current.announcement,
    };
}

const forecastEvent = (payload: Record<string, unknown>): SSEEvent =>
    ({
        id: "1",
        type: "run.forecast.updated",
        channel: `run:${RUN_ID}`,
        timestamp: "2026-08-25T00:00:00Z",
        payload: { run_id: RUN_ID, ...payload },
    }) as unknown as SSEEvent;

describe("run.forecast.updated patches the cached run", () => {
    it("applies every forecast field the event carries", () => {
        const { run } = setup();
        emit!(
            forecastEvent({
                projected_cost_cents: 4242,
                ewma_cost_cents: 100,
                budget_breach_projected: true,
                breach_kind: "cost_cents",
                forecast_at: "2026-08-25T01:02:03Z",
            }),
        );
        const r = run();
        expect(r.projected_cost_cents).toBe(4242);
        expect(r.ewma_cost_cents).toBe(100);
        expect(r.budget_breach_projected).toBe(true);
        expect(r.breach_kind).toBe("cost_cents");
        expect(r.forecast_at).toBe("2026-08-25T01:02:03Z");
    });

    it("clears a previous breach when the new forecast projects none", () => {
        // `breach_kind: null` is a value, not an absence. Treating it as
        // "unchanged" would leave a resolved breach on screen indefinitely —
        // a stale governance warning is as bad as a missing one.
        const { run } = setup({
            budget_breach_projected: true,
            breach_kind: "cost_cents",
        });
        emit!(
            forecastEvent({
                projected_cost_cents: 10,
                ewma_cost_cents: 5,
                budget_breach_projected: false,
                breach_kind: null,
                forecast_at: "2026-08-25T02:00:00Z",
            }),
        );
        expect(run().budget_breach_projected).toBe(false);
        expect(run().breach_kind).toBeUndefined();
    });

    it("drops a breach axis this build does not recognise", () => {
        // Casting an unknown string into the union would put a value on screen
        // that no label exists for.
        const { run } = setup();
        emit!(
            forecastEvent({
                projected_cost_cents: 1,
                ewma_cost_cents: 1,
                budget_breach_projected: true,
                breach_kind: "sunspots",
                forecast_at: "2026-08-25T03:00:00Z",
            }),
        );
        expect(run().breach_kind).toBeUndefined();
        // ...but the rest of the snapshot still lands.
        expect(run().projected_cost_cents).toBe(1);
    });

    it("leaves the cache alone when there is no run to patch", () => {
        const queryClient = new QueryClient();
        const wrapper = ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        );
        renderHook(() => useRunChannel(RUN_ID), { wrapper });
        emit!(forecastEvent({ projected_cost_cents: 1 }));
        // Not an invented skeleton run: a forecast is not enough to describe a run.
        expect(queryClient.getQueryData(["run", RUN_ID])).toBeUndefined();
    });
});

describe("coherence.divergence.detected patches the cached run", () => {
    const coherence = (payload: Record<string, unknown>): SSEEvent =>
        ({
            id: "2",
            type: "coherence.divergence.detected",
            channel: `run:${RUN_ID}`,
            timestamp: "2026-08-25T00:00:00Z",
            payload: { run_id: RUN_ID, record_id: "aud_1", ...payload },
        }) as unknown as SSEEvent;

    it("sets the flag, because the event's arrival IS the flag", () => {
        const { run } = setup({ coherence_divergence_flagged: false });
        emit!(coherence({ response_level: "require_approval" }));
        expect(run().coherence_divergence_flagged).toBe(true);
        expect(run().response_level).toBe("require_approval");
    });

    it("still sets the flag when the rung is unrecognised", () => {
        // The divergence is the important fact. Dropping it because one
        // adjacent field was unfamiliar would lose the signal entirely.
        const { run } = setup();
        emit!(coherence({ response_level: "R9_from_the_future" }));
        expect(run().coherence_divergence_flagged).toBe(true);
        expect(run().response_level).toBeUndefined();
    });

    it("does not touch forecast fields", () => {
        const { run } = setup({ projected_cost_cents: 999 });
        emit!(coherence({ response_level: "allow_and_log" }));
        expect(run().projected_cost_cents).toBe(999);
    });
});

describe("governance escalations are announced, because nothing else says them", () => {
    // Each of these creates a badge that did not exist a moment ago. Under
    // polling there was no discrete instant at which the client knew an
    // escalation had happened; this hook creates that instant, so discarding it
    // would waste the only chance to tell a screen-reader user.

    it("announces a projected budget breach, naming the axis", () => {
        const { announcement } = setup({ budget_breach_projected: false });
        act(() => {
            emit!(
                forecastEvent({
                    projected_cost_cents: 900,
                    ewma_cost_cents: 100,
                    budget_breach_projected: true,
                    breach_kind: "wall_time",
                    forecast_at: "2026-08-25T01:00:00Z",
                }),
            );
        });
        // `wall_time` is the axis that used to be dropped by a stale allowlist,
        // which downgraded this to a generic "budget".
        expect(announcement()).toMatch(/wall-time cap/);
    });

    it("announces only the TRANSITION, not every tick", () => {
        // The gateway re-emits the forecast after every step while a breach
        // persists. Re-announcing an unchanged badge each time is the flood the
        // decisions panel already avoids.
        const { announcement } = setup({ budget_breach_projected: true });
        act(() => {
            emit!(
                forecastEvent({
                    projected_cost_cents: 900,
                    ewma_cost_cents: 100,
                    budget_breach_projected: true,
                    breach_kind: "cost_cents",
                    forecast_at: "2026-08-25T01:00:00Z",
                }),
            );
        });
        expect(announcement()).toBe("");
    });

    it("says nothing when the forecast projects no breach", () => {
        const { announcement } = setup();
        act(() => {
            emit!(
                forecastEvent({
                    projected_cost_cents: 10,
                    ewma_cost_cents: 5,
                    budget_breach_projected: false,
                    breach_kind: null,
                    forecast_at: "2026-08-25T01:00:00Z",
                }),
            );
        });
        expect(announcement()).toBe("");
    });

    it("announces a coherence divergence, and says approval when the rung is R3", () => {
        const { announcement } = setup();
        act(() => {
            emit!({
                id: "2",
                type: "coherence.divergence.detected",
                channel: `run:${RUN_ID}`,
                timestamp: "2026-08-25T00:00:00Z",
                payload: {
                    run_id: RUN_ID,
                    record_id: "aud_1",
                    response_level: "require_approval",
                    // Shadow mode: recorded, NOT stopped.
                    gated: false,
                    mode: "shadow",
                },
            } as unknown as SSEEvent);
        });
        expect(announcement()).toMatch(/requires approval/);
        // Never the word "blocked": in shadow mode nothing was stopped, and
        // saying so would be the detection-vs-prevention conflation the event
        // type exists to keep apart.
        expect(announcement()).not.toMatch(/blocked|stopped|halted/i);
    });
});

