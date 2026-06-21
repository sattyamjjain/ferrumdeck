import { NextRequest, NextResponse } from "next/server";
import { getGatewayUrl, getAuthHeaders } from "@/lib/api/config";

/**
 * Export a run's redacted training-signal JSONL.
 *
 * Proxies the gateway's `POST /v1/runs/:runId/training-signal`, which projects
 * the run's trace into `(state, action, observation, outcome_score)` tuples and
 * redacts each via the audit redaction path (server-side — the dashboard never
 * sees unredacted payloads). The optional request body carries `run_score` /
 * `score_overrides`. The response is streamed back as `application/x-ndjson`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  try {
    const body = await request.text();
    const response = await fetch(
      `${getGatewayUrl()}/v1/runs/${runId}/training-signal`,
      { method: "POST", headers: getAuthHeaders(), body: body || "{}" }
    );
    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: { "Content-Type": "application/x-ndjson" },
    });
  } catch (error) {
    console.error("Error exporting training signal:", error);
    return NextResponse.json(
      { error: "Failed to export training signal" },
      { status: 500 }
    );
  }
}
