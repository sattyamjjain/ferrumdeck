import { NextResponse } from "next/server";

// NOT a stub that fabricates an empty success. The regression report needs a
// gateway eval backend to compute it, which is not wired yet (issue #7). This
// route is the worst offender of the class: returning `200 { total_regressions:
// 0 }` renders identically to "0 regressions found" when the truth is "we never
// looked", and only one of those is a clean bill of health. Return 501 with no
// invented report instead; the dashboard renders a "not implemented (#7)" state.
export async function GET() {
    return NextResponse.json(
        {
            error: "not_implemented",
            message:
                "The regression report is not implemented yet: the dashboard has no gateway eval backend to compute it. A report of 0 regressions would be indistinguishable from 'we never looked', so none is returned. Tracked in issue #7.",
            issue: "https://github.com/sattyamjjain/ferrumdeck/issues/7",
        },
        { status: 501 },
    );
}
