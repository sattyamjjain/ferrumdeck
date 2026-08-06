import { NextResponse } from "next/server";
import type { ListEvalSuitesResponse } from "@/types/eval";
import { loadEvalSuites } from "@/lib/evals/suite-loader";

// Serves the REAL eval suite definitions from evals/suites/*.yaml (issue #7,
// first slice). This is not a fabricated empty success: if the evals directory
// cannot be located the route returns 501 (below), because `200 { suites: [] }`
// would read as "no suites exist" — indistinguishable from "we never looked",
// the fabrication class this whole surface was hardened against. Runs and the
// regression report are still 501; only the suite list is backed by real data.
export async function GET() {
    const result = loadEvalSuites();

    if (result.kind === "not_found") {
        return NextResponse.json(
            {
                error: "not_implemented",
                message:
                    "The eval suites directory could not be located, so no suite data is available. " +
                    "Set FD_EVALS_DIR to the repo's evals/ directory to serve the on-disk suite " +
                    "definitions. Tracked in issue #7.",
                issue: "https://github.com/sattyamjjain/ferrumdeck/issues/7",
                searched: result.searched,
            },
            { status: 501 },
        );
    }

    const response: ListEvalSuitesResponse = {
        suites: result.suites,
        total: result.suites.length,
        offset: 0,
        limit: result.suites.length,
    };
    return NextResponse.json(response);
}
