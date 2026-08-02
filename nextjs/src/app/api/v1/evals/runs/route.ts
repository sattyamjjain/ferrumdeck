import { NextRequest, NextResponse } from "next/server";
import type { ListEvalRunsResponse } from "@/types/eval";

// Stub API route for eval runs - returns empty data until backend is implemented
export async function GET(_request: NextRequest) {
  // Return empty list response
  const response: ListEvalRunsResponse = {
    runs: [],
    total: 0,
    offset: 0,
    limit: 20,
  };

  return NextResponse.json(response);
}

export async function POST(_request: NextRequest) {
  // NOT a stub that fabricates success. Running an eval suite needs a gateway
  // eval backend to dispatch to, which is not wired yet (issue #7). Returning a
  // 201 + synthetic id would hand an operator an affirmative confirmation for
  // work that never executed — the same fabrication class the SSE mock fix
  // closed. Return 501 with no invented id instead.
  return NextResponse.json(
    {
      error: "not_implemented",
      message:
        "Running an eval suite is not implemented yet: the dashboard has no gateway eval backend to dispatch to, so no run was started. Tracked in issue #7.",
      issue: "https://github.com/sattyamjjain/ferrumdeck/issues/7",
    },
    { status: 501 }
  );
}
