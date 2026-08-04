"use client";

import { AlertTriangle, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface NotImplementedStateProps {
    /** Short heading, e.g. "Evaluations backend not implemented". Rendered as an
     *  `<h2>` so it sits cleanly under the page `<h1>` (no heading-order skip). */
    title: string;
    /** One or two sentences making clear this is "not built yet", NOT a clean
     *  bill of health. */
    description: string;
    /** Tracking-issue URL (opens in a new tab). */
    issueUrl: string;
    /** Descriptive, self-contained link text (avoid "click here" / bare "#7"). */
    issueLabel?: string;
    className?: string;
}

/**
 * A deliberately-distinct "this feature is not implemented yet" state, for the
 * case where a BFF route returns 501. It exists because rendering an *empty*
 * table/EmptyState on 501 reads as a clean bill of health ("0 runs", "no
 * regressions") when the truth is "there is no backend and we never looked".
 *
 * Accessibility (reviewed against WCAG 2.1 AA):
 * - `role="status"` (implicit polite live region): announced once when it
 *   mounts after the loading skeleton — not `role="alert"` (this is
 *   informational, not an urgent error) and it does NOT steal focus (it can
 *   mount inside a tabpanel).
 * - Title is an `<h2>` (callers keep an `<h1>` above it) to avoid an h1→h3 skip.
 * - Description uses `text-foreground-secondary` (~7.6:1 on the card bg), not
 *   the ~4.1:1 muted token used elsewhere.
 * - A non-green warning icon (not the "all clear" green check) reinforces the
 *   meaning; it is `aria-hidden` because the text carries the message.
 * - The issue link warns of the new tab for screen-reader users.
 */
export function NotImplementedState({
    title,
    description,
    issueUrl,
    issueLabel = "Track support on GitHub",
    className,
}: NotImplementedStateProps) {
    return (
        <div
            role="status"
            className={cn(
                "relative flex flex-col items-center justify-center text-center py-16",
                "rounded-xl border border-accent-yellow/20 bg-gradient-to-b from-background-secondary/50 to-background",
                className,
            )}
        >
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-accent-yellow/20 bg-accent-yellow/10">
                <AlertTriangle
                    className="h-7 w-7 text-accent-yellow"
                    strokeWidth={1.5}
                    aria-hidden="true"
                />
            </div>

            <div className="max-w-md space-y-3">
                <h2 className="text-lg font-semibold tracking-tight text-foreground font-display">
                    {title}
                </h2>
                <p className="text-sm leading-relaxed text-foreground-secondary">
                    {description}
                </p>
            </div>

            <div className="mt-6">
                <Button asChild variant="outline">
                    <a
                        href={issueUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        {issueLabel}
                        <ExternalLink
                            className="ml-2 h-4 w-4"
                            aria-hidden="true"
                        />
                        <span className="sr-only"> (opens in new tab)</span>
                    </a>
                </Button>
            </div>
        </div>
    );
}
