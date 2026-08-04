import { NextResponse } from "next/server";

// GET: NOT a stub that fabricates an empty success. Listing eval runs needs a
// gateway eval backend, which is not wired yet (issue #7). Returning
// `200 { runs: [] }` reads on the dashboard as "no runs have been executed" —
// indistinguishable from "we never looked". Return 501 with no invented payload.
export async function GET() {
    return NextResponse.json(
        {
            error: "not_implemented",
            message:
                "Listing eval runs is not implemented yet: the dashboard has no gateway eval backend to read from, so no runs were returned. Tracked in issue #7.",
            issue: "https://github.com/sattyamjjain/ferrumdeck/issues/7",
        },
        { status: 501 },
    );
}

// POST: NOT a stub that fabricates success. Running an eval suite needs a gateway
// eval backend to dispatch to, which is not wired yet (issue #7). Returning a
// 201 + synthetic id would hand an operator an affirmative confirmation for
// work that never executed — the same fabrication class the SSE mock fix
// closed. Return 501 with no invented id instead.
export async function POST() {
    return NextResponse.json(
        {
            error: "not_implemented",
            message:
                "Running an eval suite is not implemented yet: the dashboard has no gateway eval backend to dispatch to, so no run was started. Tracked in issue #7.",
            issue: "https://github.com/sattyamjjain/ferrumdeck/issues/7",
        },
        { status: 501 },
    );
}
