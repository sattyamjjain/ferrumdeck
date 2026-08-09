import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders } from "@/lib/api/config";

// GET: proxy the gateway eval-read backend (issue #7). The gateway serves the
// real on-disk eval reports, or its own 501 `NO_EVAL_STORE` when no reports
// directory is reachable (a deployed gateway does not carry repo artifacts). If
// the gateway itself is unreachable — no stack running, CI — fall back to an
// honest 501 naming #7, never a fabricated empty `200 { runs: [] }` (which reads
// on the dashboard as "no runs exist"). The #7 disclosure stays until the gateway
// eval-read path is verified end-to-end on a live stack.
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    try {
        const response = await fetch(
            `${getGatewayUrl()}/v1/evals/runs?${searchParams}`,
            { headers: getAuthHeaders() },
        );
        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        console.error("Eval runs: gateway eval backend unreachable:", error);
        return NextResponse.json(
            {
                error: "not_implemented",
                message:
                    "Listing eval runs requires the gateway eval-read backend, which is not reachable in this environment (no stack running). No runs were returned rather than an empty list. Tracked in issue #7.",
                issue: "https://github.com/sattyamjjain/ferrumdeck/issues/7",
            },
            { status: 501 },
        );
    }
}

// POST: running an eval suite needs a gateway eval-DISPATCH backend, which is not
// wired (issue #7 is the read path). Return 501 with no invented id — the same
// fabrication class the earlier synthetic-201 stub fix closed.
export async function POST() {
    return NextResponse.json(
        {
            error: "not_implemented",
            message:
                "Running an eval suite is not implemented yet: the dashboard has no gateway eval-dispatch backend, so no run was started. Tracked in issue #7.",
            issue: "https://github.com/sattyamjjain/ferrumdeck/issues/7",
        },
        { status: 501 },
    );
}
