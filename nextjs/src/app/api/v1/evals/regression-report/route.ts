import { NextRequest, NextResponse } from "next/server";
import type { RegressionReport } from "@/types/eval";

// Stub API route for regression report - returns empty data until backend is implemented
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const periodDays = parseInt(searchParams.get("period_days") || "7", 10);

  const now = new Date();
  const periodStart = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);

  // Return empty regression report
  const response: RegressionReport = {
    generated_at: now.toISOString(),
    period_start: periodStart.toISOString(),
    period_end: now.toISOString(),
    suites_analyzed: 0,
    total_regressions: 0,
    total_improvements: 0,
    regressions_by_suite: [],
    overall_cost_delta_cents: 0,
  };

  return NextResponse.json(response);
}
