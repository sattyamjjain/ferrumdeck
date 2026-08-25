import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders } from "@/lib/api/config";
import { mapGatewayRunsResponse } from "@/lib/evals/run-mapper";

// GET: serve the gateway eval-read backend, mapped onto the dashboard's EvalRun
// contract (issue #7).
//
// This route used to proxy the gateway body verbatim. That was a real read path
// that still could not render: the gateway returns `{ run_id, suite, ... }` and
// the runs table reads `run.id`, `run.suite_name`, `run.status`, so every cell
// came out blank and `runStatusConfig[run.status]` dereferenced undefined.
// `mapGatewayRunsResponse` does the projection, dropping anything unrecognizable
// rather than coercing it and recomputing the count from what survived.
//
// A non-2xx from the gateway (including its own 501 `NO_EVAL_STORE`) is passed
// through untouched — its wording is more specific than anything this layer
// could say. If the gateway is unreachable at all, fall back to an honest 501
// naming #7, never a fabricated empty `200 { runs: [] }`, which reads on the
// dashboard as "no runs exist".
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    try {
        const response = await fetch(
            `${getGatewayUrl()}/v1/evals/runs?${searchParams}`,
            { headers: getAuthHeaders() },
        );
        const data = await response.json();

        if (!response.ok) {
            return NextResponse.json(data, { status: response.status });
        }

        const mapped = mapGatewayRunsResponse(data);
        if (!mapped) {
            // A 200 whose body is not a run list means the gateway and this
            // route disagree about the contract. Saying so beats rendering an
            // empty table, which would read as "no runs have been executed".
            console.error(
                "Eval runs: unrecognized gateway response shape",
                data,
            );
            return NextResponse.json(
                {
                    error: "bad_gateway",
                    message:
                        "The gateway eval-read backend returned a body this dashboard does not recognize as a run list. No runs were returned rather than an empty list. Tracked in issue #46 (the read path, #7, is closed).",
                    issue: "https://github.com/sattyamjjain/ferrumdeck/issues/46",
                },
                { status: 502 },
            );
        }

        return NextResponse.json(mapped, { status: 200 });
    } catch (error) {
        console.error("Eval runs: gateway eval backend unreachable:", error);
        return NextResponse.json(
            {
                error: "not_implemented",
                message:
                    "Listing eval runs requires the gateway eval-read backend, which is not reachable in this environment (no stack running). No runs were returned rather than an empty list. Tracked in issue #46 (the read path, #7, is closed).",
                issue: "https://github.com/sattyamjjain/ferrumdeck/issues/46",
            },
            { status: 501 },
        );
    }
}

// POST: dispatch an eval suite (#46). Backed now — the gateway persists the run
// to the `eval_runs` store and enqueues it.
//
// The gateway answers **202 Accepted**, not 201, and this route passes that
// through unchanged. The distinction is the whole point: the run is durable and
// queryable, and it has NOT started. No eval executor consumes the queue yet, so
// it stays `pending` with `queued_at` set and `started_at` null.
//
// That is not the fabrication this route used to commit. The old stub minted a
// synthetic `eval_stub_<ts>` id and returned 201 for a run with no backend at
// all — an affirmative confirmation of work that could never happen. This run
// exists, appears in the list, and reports `unclaimed: true`; it never claims to
// have completed.
export async function POST(request: NextRequest) {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json(
            { error: "bad_request", message: "A JSON body with `suite_id` is required." },
            { status: 400 },
        );
    }

    const suiteId = (body as { suite_id?: unknown })?.suite_id;
    if (typeof suiteId !== "string" || !suiteId.trim()) {
        return NextResponse.json(
            { error: "bad_request", message: "`suite_id` is required." },
            { status: 400 },
        );
    }

    try {
        const response = await fetch(`${getGatewayUrl()}/v1/evals/runs`, {
            method: "POST",
            headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ suite_id: suiteId }),
        });
        const data = await response.json();
        // Passed through verbatim, status included. Rewriting a 202 to a 201
        // here would re-introduce exactly the claim this route stopped making.
        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        console.error("Eval dispatch: gateway unreachable:", error);
        return NextResponse.json(
            {
                error: "not_implemented",
                message:
                    "Dispatching an eval run requires the gateway, which is not reachable in this environment. No run was started and no run id was invented. Tracked in issue #46.",
                issue: "https://github.com/sattyamjjain/ferrumdeck/issues/46",
            },
            { status: 501 },
        );
    }
}
