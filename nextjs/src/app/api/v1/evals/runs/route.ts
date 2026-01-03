import { NextRequest, NextResponse } from "next/server";
import type { ListEvalRunsResponse } from "@/types/eval";

// Stub API route for eval runs - returns empty data until backend is implemented
export async function GET(request: NextRequest) {
  // Return empty list response
  const response: ListEvalRunsResponse = {
    runs: [],
    total: 0,
    offset: 0,
    limit: 20,
  };

  return NextResponse.json(response);
}

export async function POST(request: NextRequest) {
  // Stub for running eval suite - return mock response
  return NextResponse.json(
    { eval_run_id: "eval_stub_" + Date.now() },
    { status: 201 }
  );
}
