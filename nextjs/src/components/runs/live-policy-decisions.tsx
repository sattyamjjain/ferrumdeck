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
    ShieldCheck,
    ShieldOff,
    ShieldQuestion,
} from "lucide-react";
import { useSubscription } from "@/lib/realtime/use-subscription";
import {
    buildRunChannel,
    isPolicyResponseRecordedEvent,
    isStreamGapEvent,
    type PolicyResponseRecordedEvent,
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

type Decision = PolicyResponseRecordedEvent["payload"] & { eventId: string };

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
type Tally = { deny: number; approval: number; allow: number; shadow: number; other: number };
const emptyTally = (): Tally => ({ deny: 0, approval: 0, allow: 0, shadow: 0, other: 0 });

function summarize(t: Tally): string {
    const total = t.deny + t.approval + t.allow + t.shadow + t.other;
    if (total === 0) return "";
    const parts = [
        t.deny && `${t.deny} denied`,
        t.approval && `${t.approval} awaiting approval`,
        t.shadow && `${t.shadow} recorded but not blocked`,
        t.allow && `${t.allow} allowed`,
        t.other && `${t.other} unclassified`,
    ].filter(Boolean);
    return `${total} new policy ${total === 1 ? "decision" : "decisions"}. ${parts.join(", ")}.`;
}

export function LivePolicyDecisions({ runId }: { runId: string }) {
    const [decisions, setDecisions] = useState<Decision[]>([]);
    const [gaps, setGaps] = useState<Gap[]>([]);
    const [isPaused, setIsPaused] = useState(false);
    const [bufferedCount, setBufferedCount] = useState(0);
    const [announcement, setAnnouncement] = useState("");

    const bufferRef = useRef<Decision[]>([]);
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
        if (isPolicyResponseRecordedEvent(event)) {
            const entry: Decision = { ...event.payload, eventId: event.id };
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
            setBufferedCount(0);
            setDecisions((prev) => [...flushed, ...prev].slice(0, MAX_ENTRIES));
        }
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
                <ul
                    aria-label="Policy decisions, newest first"
                    className="max-h-96 space-y-2 overflow-y-auto"
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
                            </li>
                        );
                    })}
                </ul>

                {decisions.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                        {isConnected
                            ? // NOT "no policy decisions". Nothing has been pushed
                              // on this channel yet, which is a statement about the
                              // stream, not about the run.
                              "No decisions pushed on this channel yet. Decisions already recorded for this run are in the Audit tab."
                            : "Not connected to the realtime stream, so nothing is being pushed here. This is not a claim that no policy decisions were recorded — read them from the Audit tab."}
                    </p>
                )}

                {/* The announcement channel, kept separate from the readable list. */}
                <LiveRegion message={announcement} politeness="polite" />
            </CardContent>
        </Card>
    );
}
