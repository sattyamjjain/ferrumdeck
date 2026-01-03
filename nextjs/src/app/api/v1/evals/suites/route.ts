import { NextResponse } from "next/server";
import type { ListEvalSuitesResponse } from "@/types/eval";

// Stub API route for eval suites - returns empty data until backend is implemented
export async function GET() {
  // Return empty list response
  const response: ListEvalSuitesResponse = {
    suites: [],
    total: 0,
    offset: 0,
    limit: 20,
  };

  return NextResponse.json(response);
}
