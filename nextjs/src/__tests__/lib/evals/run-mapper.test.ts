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
