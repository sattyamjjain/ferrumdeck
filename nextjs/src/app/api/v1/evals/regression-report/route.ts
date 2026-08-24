import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders } from "@/lib/api/config";

// GET: proxy the gateway eval-read backend's regression report (issue #7). The
// gateway compares each suite's two most recent on-disk reports and names suites
// with insufficient history explicitly, so "0 regressions" is never confused with
// "we never looked". If the gateway is unreachable — no stack running, CI — fall
// back to an honest 501 naming #7, never a fabricated `200 { total_regressions: 0 }`.
// The #7 disclosure stays until the gateway eval-read path is verified end-to-end
// on a live stack.
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    try {
        const response = await fetch(
            `${getGatewayUrl()}/v1/evals/regression-report?${searchParams}`,
            { headers: getAuthHeaders() },
        );
        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        console.error(
            "Eval regression report: gateway eval backend unreachable:",
            error,
        );
        return NextResponse.json(
            {
                error: "not_implemented",
                message:
                    "The regression report requires the gateway eval-read backend, which is not reachable in this environment (no stack running). No report was returned rather than a fabricated '0 regressions'. Tracked in issue #46 (the read path, #7, is closed).",
                issue: "https://github.com/sattyamjjain/ferrumdeck/issues/46",
            },
            { status: 501 },
        );
    }
}
