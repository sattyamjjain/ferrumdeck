import { NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders } from "@/lib/api/config";
import { loadEvalSuites } from "@/lib/evals/suite-loader";
import { mapGatewayRun, type GatewayEvalRun } from "@/lib/evals/run-mapper";

/**
 * `GET /api/v1/evals/suites/{suiteId}` — one suite: what it IS, and what it has
 * actually SCORED.
 *
 * This route was a hard 501 (issue #7). It is backed now, and it is backed by
 * two sources on purpose, because the two facts have different owners:
 *
 *   * **Definition** — tasks, scorers, gate threshold — lives in
 *     `evals/suites/*.yaml` and is read here via `loadEvalSuites()`. That is
 *     already the declared `local_backed` source for the suite LIST, so the
 *     detail view reads the same parser rather than a second one.
 *   * **Measured history** — every run, its headline metric, and **the instant
 *     each figure was measured** — comes from the gateway's
 *     `GET /v1/evals/suites/{id}`, which reads `evals/reports/*.json`.
 *
 * Joining them here rather than duplicating either keeps one source of truth per
 * fact. The alternative — teaching the gateway to parse the suite YAML too —
 * would put the same number in two parsers that can drift, which is the failure
 * this repo just finished removing from the executed-test floor.
 *
 * Neither half is fabricated when it is missing. A definition with no runs
 * returns `runs: []` **with `history_available: false`** so the dashboard can
 * say "never run" rather than rendering a silent zero; a gateway that is
 * unreachable produces `history_available: false` and a `history_error` naming
 * why. And a suiteId that matches neither source is a real 404.
 */
export async function GET(
    _request: Request,
    { params }: { params: Promise<{ suiteId: string }> },
) {
    const { suiteId } = await params;

    // --- definition (on-disk YAML) -----------------------------------------
    const defs = loadEvalSuites();
    const definition =
        defs.kind === "ok"
            ? (defs.suites.find((s) => s.id === suiteId) ?? null)
            : null;

    // --- measured history (gateway -> evals/reports) -----------------------
    let runs: ReturnType<typeof mapGatewayRun>[] = [];
    let historyAvailable = false;
    let historyError: string | undefined;
    let latestMeasuredAt: unknown;
    let source: string | undefined;

    try {
        const response = await fetch(
            `${getGatewayUrl()}/v1/evals/suites/${encodeURIComponent(suiteId)}`,
            { headers: getAuthHeaders() },
        );
        if (response.ok) {
            const body = (await response.json()) as {
                suite?: {
                    runs?: unknown;
                    latest_measured_at?: unknown;
                };
                source?: string;
            };
            const rawRuns = body.suite?.runs;
            runs = Array.isArray(rawRuns)
                ? rawRuns
                      .filter(
                          (r): r is GatewayEvalRun =>
                              typeof r === "object" &&
                              r !== null &&
                              typeof (r as GatewayEvalRun).run_id === "string",
                      )
                      .map(mapGatewayRun)
                : [];
            latestMeasuredAt = body.suite?.latest_measured_at;
            source = body.source;
            historyAvailable = true;
        } else if (response.status === 404) {
            // The store was read and holds no run for this suite. That is a
            // real answer, not an outage: history IS available, and it is empty.
            historyAvailable = true;
        } else {
            // 501 NO_EVAL_STORE and anything else: we never looked.
            historyError = `The gateway returned ${response.status} for this suite's run history, so no measured figures are shown. This is not a claim that the suite has never run.`;
        }
    } catch {
        historyError =
            "The gateway eval-read backend is not reachable from this dashboard, so no measured figures are shown. This is not a claim that the suite has never run. Tracked in issue #7.";
    }

    if (!definition && !historyAvailable && !runs.length) {
        // Neither source could say anything about this id. 404 would claim the
        // suite does not exist, which we did not establish.
        return NextResponse.json(
            {
                error: "unavailable",
                message: `Neither the on-disk suite definitions nor the gateway's run history could be read, so nothing is known about suite '${suiteId}'. No suite data is returned rather than an empty one, which would read as "this suite is empty".`,
                issue: "https://github.com/sattyamjjain/ferrumdeck/issues/7",
            },
            { status: 503 },
        );
    }

    if (!definition && historyAvailable && runs.length === 0) {
        return NextResponse.json(
            {
                error: "not_found",
                message: `No suite '${suiteId}' exists in evals/suites/, and the eval report store holds no run for it.`,
            },
            { status: 404 },
        );
    }

    return NextResponse.json({
        suite_id: suiteId,
        // null (not a fabricated skeleton) when the YAML has no such suite but
        // the report store does — e.g. a benchmark that ships no suite file.
        definition,
        runs,
        run_count: runs.length,
        /** false means "we could not look", NOT "there are no runs". */
        history_available: historyAvailable,
        ...(historyError ? { history_error: historyError } : {}),
        /** When the newest figure above was measured, with precision + source. */
        latest_measured_at: latestMeasuredAt ?? null,
        ...(source ? { source } : {}),
    });
}
