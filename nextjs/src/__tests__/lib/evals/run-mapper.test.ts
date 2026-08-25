/**
 * The gateway -> dashboard projection for eval runs (issue #7).
 *
 * The read path was wired end to end and still could not render a run, because
 * the two sides disagreed about field names. These tests pin the projection and,
 * more importantly, pin the rule that nothing gets invented on the way through.
 */

import {
    mapGatewayRun,
    mapGatewayRunsResponse,
    type GatewayEvalRun,
} from "@/lib/evals/run-mapper";

const LLM_RUN: GatewayEvalRun = {
    run_id: "eval_regression_20260816_034522",
    suite: "regression",
    date: "2026-08-16",
    total_cases: 20,
    primary_metric: { name: "average_score", rate: 1.0 },
    assertion_coverage: 0.5,
    total_tasks: 20,
    passed_tasks: 20,
    failed_tasks: 0,
    error_tasks: 0,
    total_cost_cents: 0.5,
    total_tokens: 20156,
    total_duration_ms: 153179,
    started_at: "2026-08-16T03:45:22Z",
    completed_at: "2026-08-16T03:47:56Z",
    gate_status: "passed",
    // Added when the eval store landed (#46): the gateway sends a real status
    // now. Without it this fixture maps to "pending", which is the correct
    // fallback for a statusless response and is asserted separately below —
    // this fixture represents a stored, finished run.
    status: "completed",
    source: "committed_report",
};

describe("mapGatewayRun", () => {
    it("populates the fields the runs table actually reads", () => {
        const run = mapGatewayRun(LLM_RUN);

        // Every one of these was undefined when the route proxied verbatim.
        expect(run.id).toBe("eval_regression_20260816_034522");
        expect(run.suite_name).toBe("regression");
        expect(run.status).toBe("completed");
        expect(run.score).toBe(1.0);
        expect(run.gate_status).toBe("passed");
        expect(run.total_duration_ms).toBe(153179);
        expect(run.completed_at).toBe("2026-08-16T03:47:56Z");
    });

    it("carries assertion coverage through so a score can be read in context", () => {
        // A 1.00 at 50% coverage is an average over half a suite. The number
        // that makes that legible has to survive the mapping.
        expect(mapGatewayRun(LLM_RUN).assertion_coverage).toBe(0.5);
        expect(mapGatewayRun(LLM_RUN).primary_metric_name).toBe(
            "average_score",
        );
    });

    it("leaves coverage undefined when the gateway did not send it", () => {
        const { assertion_coverage: _omitted, ...withoutCoverage } = LLM_RUN;
        expect(
            mapGatewayRun(withoutCoverage).assertion_coverage,
        ).toBeUndefined();
    });

    it("does not invent an agent version the reports never recorded", () => {
        expect(mapGatewayRun(LLM_RUN).agent_version).toBe("");
        expect(mapGatewayRun(LLM_RUN).agent_version_id).toBe("");
    });

    it("does not turn an absent gate verdict into a pass", () => {
        const benchmark: GatewayEvalRun = {
            run_id: "asb-20260810",
            suite: "asb",
            date: "2026-08-10",
            primary_metric: { name: "block_rate_under_attack", rate: 1.0 },
        };
        const run = mapGatewayRun(benchmark);
        expect(run.gate_status).toBeUndefined();
        expect(run.score).toBe(1.0);
    });

    it("rejects a gate status the dashboard does not model", () => {
        const run = mapGatewayRun({ ...LLM_RUN, gate_status: "probably_fine" });
        expect(run.gate_status).toBeUndefined();
    });

    it("falls back to total_cases when a suite counts cases rather than tasks", () => {
        const run = mapGatewayRun({
            run_id: "asb-20260810",
            suite: "asb",
            total_cases: 31,
        });
        expect(run.total_tasks).toBe(31);
    });
});

describe("mapGatewayRunsResponse", () => {
    it("maps a gateway body and recomputes the count from what survived", () => {
        const mapped = mapGatewayRunsResponse({
            runs: [LLM_RUN, { nonsense: true }, null],
            count: 3,
            source: "evals/reports",
        });

        expect(mapped).not.toBeNull();
        expect(mapped!.runs).toHaveLength(1);
        expect(mapped!.count).toBe(1);
        expect(mapped!.source).toBe("evals/reports");
    });

    it("returns null for a body that is not a run list, rather than an empty list", () => {
        // An empty list renders as "no runs have been executed". A null makes
        // the route answer 502 and say the contract disagreed.
        expect(mapGatewayRunsResponse({ error: "nope" })).toBeNull();
        expect(mapGatewayRunsResponse(null)).toBeNull();
        expect(mapGatewayRunsResponse("runs")).toBeNull();
    });

    it("maps an genuinely empty gateway list to an empty list", () => {
        const mapped = mapGatewayRunsResponse({ runs: [], count: 0 });
        expect(mapped).toEqual({ runs: [], count: 0, source: undefined });
    });
});

describe("measurement time survives the projection (#7)", () => {
    // A governance number without its measurement time asserts that it is
    // current, which nothing here can support. These assert the value the
    // gateway measured reaches the row the dashboard renders, unchanged.

    it("carries measured_at, its precision and its source through unchanged", () => {
        const mapped = mapGatewayRun({
            run_id: "eval_smoke_20260824_030710",
            suite: "smoke",
            date: "2026-08-24",
            measured_at: {
                at: "2026-08-24T03:07:10.966639+00:00",
                precision: "second",
                source: "report.started_at",
            },
            report_run_id: "eval_ad440ecd64fd",
            dataset_name: "safe-pr-agent",
            primary_metric: { name: "average_score", rate: 1.0 },
        });

        expect(mapped.measured_at).toEqual({
            at: "2026-08-24T03:07:10.966639+00:00",
            precision: "second",
            source: "report.started_at",
        });
        expect(mapped.report_run_id).toBe("eval_ad440ecd64fd");
        expect(mapped.dataset_name).toBe("safe-pr-agent");
    });

    it("keeps day precision as a date rather than padding it to midnight", () => {
        // asb / governed-benchmark reports carry no clock time. Rendering
        // "2026-08-22T00:00:00" would assert a midnight run that never happened.
        const mapped = mapGatewayRun({
            run_id: "asb-20260822",
            suite: "asb",
            date: "2026-08-22",
            measured_at: {
                at: "2026-08-22",
                precision: "day",
                source: "filename",
            },
        });
        expect(mapped.measured_at?.precision).toBe("day");
        expect(mapped.measured_at?.at).toBe("2026-08-22");
        expect(mapped.created_at).toBe("2026-08-22");
    });

    it("drops a malformed measured_at rather than half-rendering it", () => {
        const mapped = mapGatewayRun({
            run_id: "asb-20260822",
            suite: "asb",
            // `precision: "hour"` is not a value this contract defines.
            measured_at: { at: "2026-08-22", precision: "hour" } as never,
        });
        expect(mapped.measured_at).toBeUndefined();
    });

    it("leaves measured_at absent when the gateway sends none", () => {
        // Never inferred from anything client-side. Absent means "not recorded".
        const mapped = mapGatewayRun({ run_id: "x-20260101", suite: "x" });
        expect(mapped.measured_at).toBeUndefined();
    });
});

describe("status is read, not assumed (#46)", () => {
    // It was hardcoded to "completed" — true of the old file-backed store, which
    // only ever held finished runs, and false the moment a dispatch path landed.
    // A status field that has only ever held one value is not a status field.

    it.each([
        ["pending", "pending"],
        ["running", "running"],
        ["completed", "completed"],
        ["failed", "failed"],
        ["cancelled", "cancelled"],
    ])("passes %s through unchanged", (sent, expected) => {
        const mapped = mapGatewayRun({ run_id: "r", suite: "s", status: sent });
        expect(mapped.status).toBe(expected);
    });

    it("falls back to pending, NOT completed, when the status is absent", () => {
        // A gateway predating the store sends none. Reporting that as finished
        // would assert an outcome nobody established; "pending" claims only that
        // the run exists.
        const mapped = mapGatewayRun({ run_id: "r", suite: "s" });
        expect(mapped.status).toBe("pending");
    });

    it("falls back to pending for a status this build does not recognise", () => {
        const mapped = mapGatewayRun({
            run_id: "r",
            suite: "s",
            status: "quantum_superposition",
        });
        expect(mapped.status).toBe("pending");
        expect(mapped.status).not.toBe("completed");
    });

    it("carries the provenance and the unclaimed flag", () => {
        // `status` says whether a run finished; `run_source` says whether anyone
        // vouched for it. A committed report passed CI; a dispatched run is
        // whatever someone clicked.
        const dispatched = mapGatewayRun({
            run_id: "evr_1",
            suite: "smoke",
            status: "pending",
            source: "dispatched",
            unclaimed: true,
            queued_at: "2026-08-25T14:00:00Z",
        });
        expect(dispatched.run_source).toBe("dispatched");
        expect(dispatched.unclaimed).toBe(true);
        expect(dispatched.queued_at).toBe("2026-08-25T14:00:00Z");

        const ingested = mapGatewayRun({
            run_id: "eval_smoke_1",
            suite: "smoke",
            status: "completed",
            source: "committed_report",
        });
        expect(ingested.run_source).toBe("committed_report");
        expect(ingested.unclaimed).toBe(false);
    });

    it("drops a source value it does not recognise rather than casting it", () => {
        const mapped = mapGatewayRun({
            run_id: "r",
            suite: "s",
            source: "smuggled_in",
        });
        expect(mapped.run_source).toBeUndefined();
    });
});


