"use client";

/**
 * Subscribe to a run's realtime channel and apply what it pushes to the cached
 * run (issue #47).
 *
 * The gateway now emits four run-channel events, each published only after the
 * record it describes has committed. Two of them carry every field the polled
 * run view needed, so the console can stop waiting for the next poll interval
 * to show them:
 *
 *   * `run.forecast.updated` carries the complete forecast — projected and EWMA
 *     cost, the breach flag, the breach axis, and `forecast_at`. That is every
 *     forecast field on `Run`, so the patch below is total rather than partial.
 *   * `coherence.divergence.detected` establishes `coherence_divergence_flagged`
 *     (its arrival IS the flag) and carries the graduated-response rung.
 *
 * ## Why the poll is NOT retired
 *
 * `useRun` still polls, and that is deliberate rather than leftover.
 *
 *   * The other run fields — `status`, `cost_cents`, token counts, step
 *     progress — have no push behind them. Retiring the poll would freeze them.
 *   * A patch is not a substitute for a fetch when the stream can gap. The
 *     transport reports `stream.gap` when a reconnect falls outside the
 *     gateway's bounded replay buffer, and the poll is what recovers the state
 *     the gap swallowed.
 *
 * So this narrows what the poll is load-bearing FOR; it does not pretend to
 * replace it. No field below is invented to make a poll look retired: every one
 * comes from the event.
 */

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@/lib/realtime/use-subscription";
import {
    buildRunChannel,
    isCoherenceDivergenceDetectedEvent,
    isRunForecastUpdatedEvent,
    type SSEEvent,
} from "@/lib/realtime/channels";
import type { BudgetBreachKind, ResponseLevel, Run } from "@/types/run";

/**
 * Exactly the `BudgetBreachKind` union — typed against it, not restated as
 * strings, so the compiler rejects drift.
 *
 * The first version of this list was written from the Rust enum's field names
 * rather than the TypeScript contract and got it wrong in both directions: it
 * allowlisted `tokens` and `wall_time_ms`, neither of which exists, and omitted
 * `wall_time`, which the gateway genuinely emits
 * (`breach_kind_label` in handlers/runs.rs). A wall-time breach was therefore
 * dropped here and the badge fell back to a generic "exceeds budget" — losing
 * the axis, which is the part a reader most needs.
 */
const BREACH_KINDS: readonly BudgetBreachKind[] = [
    "cost_cents",
    "tool_calls",
    "wall_time",
];

const RESPONSE_LEVELS: readonly string[] = [
    "allow_and_log",
    "allow_under_budget",
    "require_approval",
];

function asBreachKind(v: unknown): BudgetBreachKind | null | undefined {
    if (v === null) return null;
    // `includes` on a `readonly BudgetBreachKind[]` will not accept a bare
    // string, which is the point: the widening happens here, once, after the
    // membership test rather than before it.
    return typeof v === "string" &&
        (BREACH_KINDS as readonly string[]).includes(v)
        ? (v as BudgetBreachKind)
        : undefined;
}

function asResponseLevel(v: unknown): ResponseLevel | undefined {
    return typeof v === "string" && RESPONSE_LEVELS.includes(v)
        ? (v as ResponseLevel)
        : undefined;
}

/**
 * Spoken axis names. Mirrors `breachLabel` in `budget-projection-badge.tsx` so
 * what a screen reader hears matches what the badge shows.
 */
const BREACH_LABEL: Record<BudgetBreachKind, string> = {
    cost_cents: "cost cap",
    tool_calls: "tool-call cap",
    wall_time: "wall-time cap",
};

export function useRunChannel(runId: string, enabled = true) {
    const queryClient = useQueryClient();
    const [announcement, setAnnouncement] = useState("");

    /**
     * Announce a governance escalation.
     *
     * Cleared shortly after so a second escalation with identical wording is
     * still a DOM change and is still announced.
     */
    const announce = useCallback((message: string) => {
        setAnnouncement(message);
        setTimeout(() => setAnnouncement(""), 1000);
    }, []);

    const onMessage = useCallback(
        (event: SSEEvent) => {
            if (isRunForecastUpdatedEvent(event)) {
                const p = event.payload;
                // Read before writing rather than announcing from inside the
                // updater: an announcement is a side effect and does not belong
                // in a cache-merge function.
                const prev = queryClient.getQueryData<Run>(["run", runId]);
                if (!prev) return; // nothing rendered yet; the poll will fill it
                const wasProjected = prev.budget_breach_projected === true;
                const kind = asBreachKind(p.breach_kind);

                queryClient.setQueryData<Run>(["run", runId], {
                    ...prev,
                    projected_cost_cents: p.projected_cost_cents,
                    ewma_cost_cents: p.ewma_cost_cents,
                    budget_breach_projected: p.budget_breach_projected,
                    // `null` is a real value here — no breach projected — and
                    // must overwrite a previous breach rather than being
                    // treated as "unchanged".
                    breach_kind: kind ?? undefined,
                    forecast_at: p.forecast_at,
                });

                // Announce the TRANSITION only. The gateway re-emits the
                // forecast after every step while a breach persists, and
                // re-announcing an unchanged badge on each tick is the flood
                // the decisions panel already avoids. Polite, not assertive:
                // this is a projection, not an emergency.
                //
                // The badge these words describe does not exist in the DOM
                // until the flag flips, so its appearance is otherwise
                // completely silent — under polling there was no moment at
                // which the client knew an escalation had happened. This hook
                // creates that moment; discarding it would waste the only
                // chance to say so.
                if (p.budget_breach_projected && !wasProjected) {
                    announce(
                        `Run projected to exceed its ${kind ? BREACH_LABEL[kind] : "budget"}.`,
                    );
                }
                return;
            }

            if (isCoherenceDivergenceDetectedEvent(event)) {
                const prev = queryClient.getQueryData<Run>(["run", runId]);
                if (!prev) return;
                const wasFlagged = prev.coherence_divergence_flagged === true;
                const level = asResponseLevel(event.payload.response_level);

                queryClient.setQueryData<Run>(["run", runId], {
                    ...prev,
                    // The event's arrival is the flag: the gateway only emits it
                    // when a divergence was recorded.
                    coherence_divergence_flagged: true,
                    ...(level ? { response_level: level } : {}),
                });

                if (!wasFlagged) {
                    // `gated` is deliberately NOT spoken. In shadow mode — the
                    // default — nothing was stopped, and saying "blocked" would
                    // be the detection-vs-prevention conflation this event type
                    // exists to keep apart.
                    announce(
                        level === "require_approval"
                            ? "Coherence divergence detected; this run now requires approval."
                            : "Coherence divergence detected on this run.",
                    );
                }
            }
        },
        [queryClient, runId, announce],
    );

    const subscription = useSubscription(buildRunChannel(runId), onMessage, {
        enabled,
    });
    return { ...subscription, announcement };
}
