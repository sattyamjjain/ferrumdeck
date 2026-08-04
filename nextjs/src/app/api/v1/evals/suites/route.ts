import { NextResponse } from "next/server";

// NOT a stub that fabricates an empty success. Listing eval suites needs a
// gateway eval backend to read from, which is not wired yet (issue #7).
// Returning `200 { suites: [] }` reads on the dashboard as "no suites exist" —
// indistinguishable from "we never looked", the same fabrication class the SSE
// mock generator and the eval-run POST already had. Return 501 with no invented
// payload instead; the dashboard renders a "not implemented (#7)" state.
export async function GET() {
    return NextResponse.json(
        {
            error: "not_implemented",
            message:
                "Listing eval suites is not implemented yet: the dashboard has no gateway eval backend to read from, so no suites were returned. Tracked in issue #7.",
            issue: "https://github.com/sattyamjjain/ferrumdeck/issues/7",
        },
        { status: 501 },
    );
}
