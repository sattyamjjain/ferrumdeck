"use client";

/**
 * Live policy decisions for one run, pushed over SSE (issue #5).
 *
 * Before this, the realtime channel carried heartbeats only and every
 * governance value on the console came from polling. The gateway now emits
 * `policy.response.recorded` from inside the audit write, after the row
 * commits, so each entry here names a record that already exists and can be
 * fetched from `GET /v1/audit/{record_id}`.
 *
 * Four things this panel deliberately does NOT do, because each would restate a
 * bug this repository has already paid for:
 *
 *  1. It never renders an empty list as "no policy decisions". Until an event
 *     arrives, the honest statement is "nothing has been pushed yet", and when
 *     the stream is degraded it says the stream is degraded. An audit surface
 *     that shows a confident zero it did not verify is the fabrication class
 *     the eval endpoints and the SSE mock generator were both fixed for.
 *  2. It never lets `shadow_mode` swallow the verdict. A shadow-mode Deny and a
 *     shadow-mode Allow are opposite facts -- "we would have blocked this and
 *     did not" versus "nothing was wrong" -- so shadow QUALIFIES the label
 *     rather than replacing it.
 *  3. It distinguishes a decision that was not recorded from one this build does
 *     not recognise. Rendering an unfamiliar verdict as "not recorded" would be
 *     a false statement about the audit trail, which is the same defect class as
 *     an empty 200 reading as "none found".
 *  4. It surfaces `stream.gap` rather than swallowing it. A gap treated as quiet
 *     is what makes an SSE audit stream worse than polling.
 *
 * ## Accessibility
 *
 * The visible list is NOT a live region, and that is deliberate. A `polite`
 * region over a feed that can emit several events per second queues serially:
 * screen-reader users fall progressively further behind real time while the
 * container mutates under their reading cursor, so the feed becomes both too
 * noisy to tolerate and impossible to actually read. Announcements are instead
 * throttled summaries on a separate visually-hidden region, and the feed itself
 * can be paused (WCAG 2.2.2, which auto-updating content must satisfy at
 * Level A) using the same buffer-and-flush pattern as `log-viewer.tsx`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
    AlertTriangle,
    Pause,
    Play,
    Radio,
    Route,
    ShieldCheck,
    ShieldOff,
    ShieldQuestion,
} from "lucide-react";
import { useSubscription } from "@/lib/realtime/use-subscription";
import {
    buildRunChannel,
    isPolicyDecisionExplainedEvent,
    isPolicyResponseRecordedEvent,
    isRoutingDecisionRecordedEvent,
    isStreamGapEvent,
    type PolicyDecisionExplainedEvent,
    type PolicyResponseRecordedEvent,
    type RoutingDecisionRecordedEvent,
    type SSEEvent,
} from "@/lib/realtime/channels";
import { LiveRegion } from "@/components/accessibility/live-region";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Newest first, capped so a long run cannot grow the DOM without bound. */
const MAX_ENTRIES = 50;
/** How often the throttled summary is announced. */
const ANNOUNCE_INTERVAL_MS = 10_000;

type Decision = PolicyResponseRecordedEvent["payload"] & {
    eventId: string;
    /**
     * The precedence trace for this same decision, attached when
     * `policy.decision.explained` arrives. Both events are published from one
     * committed row, so they are joined on `record_id` rather than on
     * arrival order — which is not guaranteed and would silently mis-pair
     * under concurrency.
     */
    explanation?: PolicyDecisionExplainedEvent["payload"];
};

type Routing = RoutingDecisionRecordedEvent["payload"] & { eventId: string };

interface Gap {
    eventId: string;
    message: string;
}

type ToneKey = "deny" | "approval" | "allow" | "unrecorded" | "unrecognized";

/**
 * Map the effective decision to a tone.
 *
 * `shadow_mode` is NOT consulted here. It qualifies the label at the render
 * site instead, because a shadow-mode Deny and a shadow-mode Allow must not
 * collapse to one appearance.
 *
 * The two "we don't know" cases are kept apart on purpose: `unrecorded` means
 * the event carried no decision (an older gateway), `unrecognized` means it
 * carried one this build has no label for. Reporting the second as the first
 * would assert something false about the audit trail.
 */
function decisionTone(decision: string | undefined): ToneKey {
    switch (decision) {
        case "Deny":
            return "deny";
        case "RequiresApproval":
            return "approval";
        case "Allow":
        case "AllowWithWarning":
            return "allow";
        case undefined:
        case "":
            return "unrecorded";
        default:
            return "unrecognized";
    }
}

const toneConfig = {
    deny: {
        Icon: ShieldOff,
        label: "Denied",
        className: "border-red-500/40 bg-red-500/10 text-red-300",
    },
    approval: {
        Icon: ShieldQuestion,
        label: "Approval required",
        className: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    },
    allow: {
        Icon: ShieldCheck,
        label: "Allowed",
        className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    },
    unrecorded: {
        Icon: ShieldQuestion,
        label: "Decision not recorded",
        className: "border-slate-500/40 bg-slate-500/10 text-slate-300",
    },
    unrecognized: {
        Icon: AlertTriangle,
        label: "Decision not recognised by this dashboard",
        className: "border-violet-500/40 bg-violet-500/10 text-violet-200",
    },
} as const satisfies Record<ToneKey, unknown>;

/** Which counter a decision contributes to in the announced summary. */
type Tally = {
    deny: number;
    approval: number;
    allow: number;
    shadow: number;
    other: number;
    routing: number;
};
const emptyTally = (): Tally => ({
    deny: 0,
    approval: 0,
    allow: 0,
    shadow: 0,
    other: 0,
    routing: 0,
});

function summarize(t: Tally): string {
    const decided = t.deny + t.approval + t.allow + t.shadow + t.other;
    const sentences: string[] = [];
    if (decided > 0) {
        const parts = [
            t.deny && `${t.deny} denied`,
            t.approval && `${t.approval} awaiting approval`,
            t.shadow && `${t.shadow} recorded but not blocked`,
            t.allow && `${t.allow} allowed`,
            t.other && `${t.other} unclassified`,
        ].filter(Boolean);
        sentences.push(
            `${decided} new policy ${decided === 1 ? "decision" : "decisions"}. ${parts.join(", ")}.`,
        );
    }
    // Counted separately rather than folded into the policy total: a routing
    // choice is not an enforcement verdict, and summing them would overstate
    // how many calls the policy plane actually judged.
    if (t.routing > 0) {
        sentences.push(
            `${t.routing} new routing ${t.routing === 1 ? "decision" : "decisions"}.`,
        );
    }
    return sentences.join(" ");
}

export function LivePolicyDecisions({ runId }: { runId: string }) {
    const [decisions, setDecisions] = useState<Decision[]>([]);
    const [gaps, setGaps] = useState<Gap[]>([]);
    const [isPaused, setIsPaused] = useState(false);
    const [bufferedCount, setBufferedCount] = useState(0);
    const [announcement, setAnnouncement] = useState("");

    const [routings, setRoutings] = useState<Routing[]>([]);
    const bufferRef = useRef<Decision[]>([]);
    const routingBufferRef = useRef<Routing[]>([]);
    /** Explanations that arrived before the verdict they belong to. */
    const pendingExplanationsRef = useRef<
        Map<string, PolicyDecisionExplainedEvent["payload"]>
    >(new Map());
    const pausedRef = useRef(false);
    const tallyRef = useRef<Tally>(emptyTally());

    // Mirror the pause flag into a ref so the SSE callback identity stays
    // stable. Re-creating the callback on every pause toggle would tear down
    // and rebuild the subscription, and on this channel a rebuild means
    // dropping whatever arrives in the gap. Written in an effect rather than
    // during render: a ref mutated in render is not a render output, and React
    // 19's compiler lint rejects it.
    useEffect(() => {
        pausedRef.current = isPaused;
    }, [isPaused]);

    const onMessage = useCallback((event: SSEEvent) => {
        // The "why" for a decision already shown, or one still to arrive. Joined
        // on record_id: both events describe the same committed row, and
        // relying on arrival order would mis-pair them under concurrency.
        //
        // Deliberately NOT held by the pause: this adds detail to a row that is
        // already on screen and changes neither its identity nor its position,
        // so it cannot move content under a reader the way a prepend does.
        if (isPolicyDecisionExplainedEvent(event)) {
            const explanation = event.payload;
            setDecisions((prev) =>
                prev.map((d) =>
                    d.record_id && d.record_id === explanation.record_id
                        ? { ...d, explanation }
                        : d,
                ),
            );
            pendingExplanationsRef.current.set(explanation.record_id, explanation);
            return;
        }

        if (isRoutingDecisionRecordedEvent(event)) {
            const entry: Routing = { ...event.payload, eventId: event.id };
            tallyRef.current.routing += 1;

            if (pausedRef.current) {
                // Routing entries mutate the same auto-updating panel the
                // control labelled "Pause feed" presents itself as governing
                // (WCAG 2.2.2). Letting them through would make that control
                // misreport what it stopped, which is worse than having none.
                // Buffered, not dropped: pausing the view must never lose a
                // record.
                routingBufferRef.current.push(entry);
                setBufferedCount(
                    bufferRef.current.length + routingBufferRef.current.length,
                );
                return;
            }
            setRoutings((prev) => [entry, ...prev].slice(0, MAX_ENTRIES));
            return;
        }

        if (isPolicyResponseRecordedEvent(event)) {
            const entry: Decision = { ...event.payload, eventId: event.id };
            // The explanation can win the race to the client. Attach it here so
            // ordering between the two never decides whether it is shown.
            if (entry.record_id) {
                const early = pendingExplanationsRef.current.get(entry.record_id);
                if (early) {
                    entry.explanation = early;
                    pendingExplanationsRef.current.delete(entry.record_id);
                }
            }
            const tone = decisionTone(entry.decision);
            const bucket: keyof Tally = entry.shadow_mode
                ? "shadow"
                : tone === "deny" || tone === "approval" || tone === "allow"
                  ? tone
                  : "other";
            tallyRef.current[bucket] += 1;

            if (pausedRef.current) {
                // Buffered, not dropped. Pausing the view must never mean losing
                // an enforcement verdict.
                bufferRef.current.push(entry);
                setBufferedCount(bufferRef.current.length);
                return;
            }
            setDecisions((prev) => [entry, ...prev].slice(0, MAX_ENTRIES));
            return;
        }

        if (isStreamGapEvent(event)) {
            if (event.type === "stream.connected") return;
            setGaps((prev) =>
                // A degraded stream repeats its notice; each repeat carries a
                // fresh id, so without this the same sentence remounts and is
                // re-announced indefinitely.
                prev.some((g) => g.message === event.payload.message)
                    ? prev
                    : [
                          { eventId: event.id, message: event.payload.message },
                          ...prev,
                      ].slice(0, 3),
            );
        }
    }, []);

    // The stream going dark is the most important state change in this panel,
    // and it was previously visible only as a colour on a badge. Announced from
    // the subscription's own status callback rather than from an effect
    // watching `status`: the callback IS the external-system notification, and
    // calling setState from an effect body cascades renders.
    const onStatusChange = useCallback((next: string) => {
        setAnnouncement(`Policy decision stream ${next}.`);
    }, []);

    const { status, isConnected } = useSubscription(
        buildRunChannel(runId),
        onMessage,
        { onStatusChange },
    );

    const handleResume = () => {
        setIsPaused(false);
        if (bufferRef.current.length > 0) {
            const flushed = bufferRef.current.slice().reverse();
            bufferRef.current = [];
            setDecisions((prev) => [...flushed, ...prev].slice(0, MAX_ENTRIES));
        }
        if (routingBufferRef.current.length > 0) {
            const flushed = routingBufferRef.current.slice().reverse();
            routingBufferRef.current = [];
            setRoutings((prev) => [...flushed, ...prev].slice(0, MAX_ENTRIES));
        }
        setBufferedCount(0);
    };

    // Throttled summary rather than one announcement per event.
    useEffect(() => {
        const timer = setInterval(() => {
            const message = summarize(tallyRef.current);
            if (!message) return;
            tallyRef.current = emptyTally();
            setAnnouncement(message);
            // Clear so an identical next summary is still a DOM change and is
            // still announced.
            setTimeout(() => setAnnouncement(""), 500);
        }, ANNOUNCE_INTERVAL_MS);
        return () => clearInterval(timer);
    }, []);

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
                {/* A real heading: shadcn's CardTitle renders a plain div, so
                    the panel could not be reached by heading navigation. */}
                <h2 className="flex items-center gap-2 text-base leading-none font-semibold">
                    <Radio aria-hidden="true" className="h-4 w-4" />
                    Policy decisions (live)
                </h2>
                <div className="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => (isPaused ? handleResume() : setIsPaused(true))}
                    >
                        {isPaused ? (
                            <Play aria-hidden="true" className="mr-1 h-3.5 w-3.5" />
                        ) : (
                            <Pause aria-hidden="true" className="mr-1 h-3.5 w-3.5" />
                        )}
                        {isPaused
                            ? `Resume feed${bufferedCount ? ` (${bufferedCount} buffered)` : ""}`
                            : "Pause feed"}
                    </Button>
                    <Badge
                        variant="outline"
                        className={cn(
                            "font-mono text-xs",
                            isConnected ? "text-emerald-300" : "text-slate-400",
                        )}
                    >
                        {/* Text, not only colour. */}
                        stream: {status}
                    </Badge>
                </div>
            </CardHeader>

            <CardContent className="space-y-3">
                {gaps.map((gap) => (
                    <p
                        key={gap.eventId}
                        // `status`, not `alert`: this is informational and
                        // persistent, and an assertive repeat would interrupt
                        // the operator with the same sentence over and over.
                        role="status"
                        className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200"
                    >
                        <AlertTriangle aria-hidden="true" className="mr-2 inline h-4 w-4" />
                        <span className="sr-only">Stream warning: </span>
                        {gap.message}
                    </p>
                ))}

                {/* Plain list. See the Accessibility note above for why this is
                    not the live region. */}
                {/* `tabIndex={0}` because this scrolls: without a focusable
                    descendant, a keyboard-only user cannot reach the content
                    below the fold. Chromium has implicit focusable scrollers,
                    but Firefox and Safari do not, and the implicit stop is
                    anonymous besides. `tabindex` does not change the implicit
                    `list` role, so the semantics are untouched — putting it on
                    each <li> would instead create 50 tab stops that reorder
                    between keystrokes as entries prepend. */}
                <ul
                    tabIndex={0}
                    aria-label="Policy decisions, newest first"
                    className="max-h-96 space-y-2 overflow-y-auto rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                    {decisions.map((d) => {
                        const tone = toneConfig[decisionTone(d.decision)];
                        return (
                            <li
                                key={d.eventId}
                                className={cn(
                                    "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border p-3 text-sm",
                                    tone.className,
                                )}
                            >
                                <tone.Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                                <span className="font-medium">
                                    {tone.label}
                                    {/* Qualifies the verdict; never replaces it. */}
                                    {d.shadow_mode ? " (shadow mode — the call was allowed)" : ""}
                                </span>
                                {/* An unrecognised verdict shows its raw value, so
                                    the operator can act on it even though this
                                    build has no label for it. */}
                                {decisionTone(d.decision) === "unrecognized" && (
                                    <code className="font-mono text-xs">
                                        <span className="sr-only">Reported decision: </span>
                                        {d.decision}
                                    </code>
                                )}
                                <code className="font-mono text-xs">
                                    <span className="sr-only">Tool: </span>
                                    {d.tool_name}
                                </code>
                                <span className="text-xs opacity-80">
                                    {/* `rule` is null when nothing matched and
                                        deny-by-default refused the call. That is a
                                        different fact from "no rule was recorded". */}
                                    rule: {d.rule ?? "none matched (deny-by-default)"}
                                </span>
                                {typeof d.latency_ms === "number" && (
                                    <span className="text-xs opacity-80">
                                        <span className="sr-only">Check latency: </span>
                                        {d.latency_ms} ms
                                    </span>
                                )}
                                {d.record_id && (
                                    <code className="ml-auto font-mono text-xs opacity-70">
                                        <span className="sr-only">Audit record: </span>
                                        {d.record_id}
                                    </code>
                                )}
                                {/* The precedence trace, when its event has
                                    arrived. Absent means "not received yet" --
                                    which is a different fact from "no trace
                                    exists", and previously rendered identically
                                    to it. A sighted reader sees the paragraph
                                    pop in later; a screen-reader user reads the
                                    row once and nothing would ever tell them.
                                    Hence the sr-only marker below rather than
                                    silence. Deliberately not a live region: one
                                    announcement per decision is exactly the
                                    flood the throttled summary exists to avoid. */}
                                {d.explanation ? (
                                    <p className="w-full text-xs opacity-80">
                                        {d.explanation.overrides.length > 0 ? (
                                            <>
                                                Overrode{" "}
                                                {d.explanation.overrides
                                                    .map((o) => `${o.kind} (${o.source})`)
                                                    .join(", ")}{" "}
                                                — {d.explanation.precedence}
                                            </>
                                        ) : (
                                            <>
                                                {d.explanation.matched_count === 0
                                                    ? "No rule matched; deny-by-default applied."
                                                    : "Sole matching verdict; nothing to override."}
                                            </>
                                        )}
                                    </p>
                                ) : (
                                    <span className="sr-only">
                                        Precedence trace not received yet for
                                        this decision.
                                    </span>
                                )}
                            </li>
                        );
                    })}
                </ul>

                {/* A plain div below, not a named section. A named section is
                    role="region" -- a landmark -- and a secondary list nested
                    inside a card is not a navigable destination. It is also
                    conditionally mounted, so it would materialise mid-read for
                    someone navigating by landmark. The heading already provides
                    heading navigation, and dropping the landmark removes the
                    hardcoded id with it. */}
                {routings.length > 0 && (
                    <div>
                        <h3 className="mb-2 text-sm font-semibold">
                            Routing decisions
                        </h3>
                        <ul
                            tabIndex={0}
                            aria-label="Routing decisions, newest first"
                            className="max-h-48 space-y-2 overflow-y-auto rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        >
                            {routings.map((r) => (
                                <li
                                    key={r.eventId}
                                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-sky-500/40 bg-sky-500/10 p-3 text-sm text-sky-200"
                                >
                                    <Route aria-hidden="true" className="h-4 w-4 shrink-0" />
                                    <span className="font-medium">
                                        <span className="sr-only">Subtask: </span>
                                        {r.subtask_id}
                                    </span>
                                    <span className="text-xs">
                                        <span className="sr-only">Routed to: </span>
                                        {/* The gateway serialises `chosen` with
                                            `unwrap_or(Value::Null)`, so this can
                                            genuinely be absent. Rendering
                                            `undefined / undefined` reads as
                                            " slash " to a screen reader. */}
                                        {r.chosen
                                            ? `${r.chosen.role} / ${r.chosen.model}`
                                            : "not recorded"}
                                    </span>
                                    <span className="text-xs opacity-80">
                                        <span className="sr-only">Reason: </span>
                                        {r.reason?.code ?? "not recorded"}
                                    </span>
                                    <span className="text-xs opacity-80">
                                        {/* A missing candidate list is not an
                                            empty one. "0 candidates" would be a
                                            confident false statement that none
                                            were considered — the fabrication
                                            class this panel exists to avoid. */}
                                        {r.candidates
                                            ? `${r.candidates.length} candidate${
                                                  r.candidates.length === 1 ? "" : "s"
                                              }`
                                            : "candidates not recorded"}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {decisions.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                        {isConnected
                            ? // Scoped to VERDICTS, not "decisions": a routing
                              // decision is also a decision pushed on this
                              // channel, so the broader wording becomes false
                              // once the routing list is populated. Shown
                              // regardless of `routings` -- gating it on both
                              // being empty traded a false sentence for silence,
                              // and an unexplained empty list is the same defect
                              // as a wrong explanation.
                              "No policy verdicts pushed on this channel yet. Verdicts already recorded for this run are in the Audit tab."
                            : "Not connected to the realtime stream, so no policy verdicts are being pushed here. This is not a claim that none were recorded — read them from the Audit tab."}
                    </p>
                )}

                {/* The announcement channel, kept separate from the readable list. */}
                <LiveRegion message={announcement} politeness="polite" />
            </CardContent>
        </Card>
    );
}
