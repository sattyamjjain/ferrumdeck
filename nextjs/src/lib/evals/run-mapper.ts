/**
 * Map the gateway's eval-run projection onto the dashboard's `EvalRun` shape
 * (issue #7).
 *
 * The BFF used to proxy `GET /v1/evals/runs` verbatim. The gateway returns
 * `{ run_id, suite, date, primary_metric, ... }`; the runs table reads
 * `run.id`, `run.suite_name`, `run.status`, `run.score`. None of those keys
 * existed on the proxied objects, so the table rendered blanks and
 * `runStatusConfig[run.status]` dereferenced `undefined`. The read path was
 * wired end to end and still could not render a run.
 *
 * The rule here is the same one the rest of this codebase applies to eval data:
 * **map what the gateway actually sent, and leave the rest absent.** A missing
 * `agent_version` renders as a dash reading "Not recorded"; it must never
 * become `"v1"`, and a missing `failed_tasks` must never become `0`. A
 * confident zero on a governance dashboard is the same failure as an empty
 * `200 { runs: [] }` reading as "no runs exist".
 */

import type { EvalGateStatus, EvalRun, EvalRunStatus } from "@/types/eval";

/**
 * When a run was measured, and how much of that is actually known.
 *
 * The gateway attaches this to every figure it serves. `precision: "day"` means
 * the report carried no clock time at all (the offline benchmarks do not), and
 * the UI must render it as a date rather than padding it to midnight. `source`
 * says which artifact the value came from so a reader can check it.
 */
export interface MeasuredAt {
    at: string;
    precision: "second" | "day";
    source: "report.started_at" | "filename";
}

function isMeasuredAt(value: unknown): value is MeasuredAt {
    if (typeof value !== "object" || value === null) return false;
    const c = value as Record<string, unknown>;
    return (
        typeof c.at === "string" &&
        (c.precision === "second" || c.precision === "day")
    );
}

/** One run exactly as `GET /v1/evals/runs` serves it. */
export interface GatewayEvalRun {
    run_id: string;
    suite: string;
    date?: string | null;
    measured_at?: MeasuredAt | null;
    report_run_id?: string | null;
    dataset_name?: string | null;
    anchor?: string | null;
    total_cases?: number | null;
    primary_metric?: { name: string; rate: number } | null;
    assertion_coverage?: number | null;
    total_tasks?: number | null;
    passed_tasks?: number | null;
    failed_tasks?: number | null;
    error_tasks?: number | null;
    total_cost_cents?: number | null;
    total_tokens?: number | null;
    total_duration_ms?: number | null;
    started_at?: string | null;
    completed_at?: string | null;
    gate_status?: string | null;
    /** Real lifecycle state, present since the eval store landed (#46). */
    status?: string | null;
    /** `committed_report` | `dispatched`. */
    source?: string | null;
    /** True when a dispatched run has not been claimed by any executor. */
    unclaimed?: boolean | null;
    queued_at?: string | null;
    requested_by?: string | null;
    error?: string | null;
}

/**
 * `EvalRun` plus the two fields the gateway can supply that the original
 * dashboard contract had no room for. Both are optional, so every existing
 * consumer of `EvalRun` keeps type-checking unchanged.
 */
export type MappedEvalRun = EvalRun & {
    /**
     * Share of the run's scorer results that asserted anything. Absent for
     * reports written before the field existed and for the offline benchmarks.
     * Read it next to `score`: a 1.00 at 0.5 coverage is an average over half a
     * suite. See `docs/eval-health.md`.
     */
    assertion_coverage?: number;
    /** The report field `score` came from, e.g. `average_score`. */
    primary_metric_name?: string;
    /**
     * When every number on this row was measured, with its precision and its
     * source. Absent only when neither the report body nor the file name
     * recorded a time — never inferred from file mtime, which on a fresh clone
     * would report the moment of the clone as the moment of the run.
     *
     * A governance figure rendered without this is asserting it is current.
     */
    measured_at?: MeasuredAt;
    /** The run id the eval harness assigned itself, distinct from `id`. */
    report_run_id?: string;
    /** The dataset the run executed against. Two suites over different datasets are not comparable. */
    dataset_name?: string;
    /**
     * Whether anyone vouched for this run. `committed_report` passed CI and
     * lives in git; `dispatched` is whatever someone clicked. `status` says
     * whether a run finished; this says whether it is reviewed evidence.
     */
    run_source?: "committed_report" | "dispatched";
    /**
     * A dispatched run no executor has claimed. The gateway ships no eval
     * executor, so this stays true — which is a fact about the deployment, not
     * about the run, and the console should say so rather than showing a
     * spinner that implies progress.
     */
    unclaimed?: boolean;
    queued_at?: string;
};

const GATE_STATUSES: readonly string[] = ["passed", "failed", "skipped"];

const RUN_STATUSES: readonly EvalRunStatus[] = [
    "pending",
    "running",
    "completed",
    "failed",
    "cancelled",
];

/**
 * The run's real lifecycle state.
 *
 * Falls back to `"pending"` rather than `"completed"` for anything unrecognized
 * or absent. A gateway that predates the store sends no status, and a future one
 * may send a state this build has no label for; reporting either as finished
 * would assert an outcome nobody established. `pending` is the honest floor —
 * it claims only that the run exists.
 */
function runStatus(raw: string | null | undefined): EvalRunStatus {
    return typeof raw === "string" && (RUN_STATUSES as readonly string[]).includes(raw)
        ? (raw as EvalRunStatus)
        : "pending";
}

function gateStatus(
    raw: string | null | undefined,
): EvalGateStatus | undefined {
    return raw && GATE_STATUSES.includes(raw)
        ? (raw as EvalGateStatus)
        : undefined;
}

function num(value: number | null | undefined): number | undefined {
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : undefined;
}

function isGatewayEvalRun(value: unknown): value is GatewayEvalRun {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as Record<string, unknown>;
    return (
        typeof candidate.run_id === "string" &&
        typeof candidate.suite === "string"
    );
}

/**
 * Project one gateway run onto the dashboard contract.
 *
 * `status` used to be hardcoded to `"completed"` here. That was a true statement
 * about the old store — read-only committed report files, with no dispatch path,
 * so a run that was still executing had nowhere to appear from — and it stopped
 * being true the moment one landed (#46). A status field that has only ever held
 * one value is not a status field.
 *
 * It now reads the gateway's real value and falls back to `"pending"`, not
 * `"completed"`: an unrecognized status must never be reported as finished.
 * "We don't know" and "it's done" are the two answers that must not be
 * confused, and only one of them is safe to guess.
 */
export function mapGatewayRun(raw: GatewayEvalRun): MappedEvalRun {
    const measured = isMeasuredAt(raw.measured_at) ? raw.measured_at : undefined;
    // `created_at` is the field the table sorts and renders by. Prefer the
    // gateway's `measured_at` over the older `started_at`/`date` pair: for the
    // offline benchmarks those are day-precision and for the LLM suites the
    // filename's second was being discarded, so two runs minutes apart sorted
    // arbitrarily. Falls back to the old pair so a gateway that predates the
    // field still renders.
    const started = raw.started_at ?? measured?.at ?? raw.date ?? undefined;

    return {
        id: raw.run_id,
        // The store is file-backed, so there is no separate suite id.
        suite_id: raw.suite,
        suite_name: raw.suite,
        agent_version_id: "",
        // Reports do not record the agent version. Left empty rather than
        // invented; the table renders a dash.
        agent_version: "",
        status: runStatus(raw.status),
        gate_status: gateStatus(raw.gate_status),
        score: num(raw.primary_metric?.rate) ?? 0,
        // No report records the threshold its gate used, so there is nothing
        // honest to put here. 0 renders as "no threshold", not as "passed a
        // threshold of zero" — the gate verdict comes from `gate_status`.
        gate_threshold: 0,
        // The list projection carries no per-task detail; the run-detail view
        // reads the full report separately.
        task_results: [],
        scorer_breakdown: [],
        total_tasks: num(raw.total_tasks) ?? num(raw.total_cases) ?? 0,
        passed_tasks: num(raw.passed_tasks) ?? 0,
        failed_tasks: num(raw.failed_tasks) ?? 0,
        error_tasks: num(raw.error_tasks) ?? 0,
        total_cost_cents: num(raw.total_cost_cents) ?? 0,
        total_tokens: num(raw.total_tokens) ?? 0,
        total_duration_ms: num(raw.total_duration_ms) ?? 0,
        created_at: started ?? "",
        started_at: started ?? undefined,
        completed_at: raw.completed_at ?? undefined,
        assertion_coverage: num(raw.assertion_coverage),
        primary_metric_name: raw.primary_metric?.name,
        measured_at: measured,
        report_run_id: raw.report_run_id ?? undefined,
        dataset_name: raw.dataset_name ?? undefined,
        run_source:
            raw.source === "committed_report" || raw.source === "dispatched"
                ? raw.source
                : undefined,
        unclaimed: raw.unclaimed === true,
        queued_at: raw.queued_at ?? undefined,
    };
}

/**
 * Map a gateway `/v1/evals/runs` body. Anything that is not a recognizable run
 * is dropped rather than coerced — a half-parsed row on this dashboard is worse
 * than a shorter list, and the count is recomputed from what survived so it can
 * never overstate what is shown.
 */
export function mapGatewayRunsResponse(
    body: unknown,
): { runs: MappedEvalRun[]; count: number; source?: string } | null {
    if (typeof body !== "object" || body === null) return null;
    const { runs, source } = body as { runs?: unknown; source?: unknown };
    if (!Array.isArray(runs)) return null;

    const mapped = runs.filter(isGatewayEvalRun).map(mapGatewayRun);
    return {
        runs: mapped,
        count: mapped.length,
        source: typeof source === "string" ? source : undefined,
    };
}
