import { NextResponse } from "next/server";

// Reading an individual eval suite needs a gateway eval backend, which is not
// wired yet (issue #7). Without this handler the path would 404 as "suite not
// found", implying the *suite* is the problem; 501 says honestly that the
// feature isn't built. The dashboard renders a "not implemented (#7)" state.
export async function GET() {
    return NextResponse.json(
        {
            error: "not_implemented",
            message:
                "Reading an eval suite is not implemented yet: the dashboard has no gateway eval backend to read from. Tracked in issue #7.",
            issue: "https://github.com/sattyamjjain/ferrumdeck/issues/7",
        },
        { status: 501 },
    );
}
